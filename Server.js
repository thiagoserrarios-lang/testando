const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const bcrypt = require("bcryptjs");
const session = require("express-session");
const db = require("./database");

app.use(express.static("public"));

app.use(express.json());

app.use(session({
    secret: "segredo-do-jogo",
    resave: false,
    saveUninitialized: false
}));

const rooms = {};


function generateRoomCode() {
    return Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();
}

function startRound(roomCode) {

    const room = rooms[roomCode];

    if (!room) return;

    room.choices = {};

    let timer = 15;

    io.to(roomCode).emit("roundStarted", {
        round: room.round,
        timer: timer
    });

    const interval = setInterval(() => {

        io.to(roomCode).emit("timerUpdate", timer);

        timer--;

        if (timer < 0) {

            clearInterval(interval);

            calculateResults(roomCode);
        }

    }, 1000);
}

function calculateResults(roomCode) {

    const room = rooms[roomCode];

    if (!room) return;

    const count = {};
    const roundPoints = {};

    room.players.forEach(player => {
        roundPoints[player.id] = 0;
    });

    // Conta quantas vezes cada número foi escolhido
    for (const playerId in room.choices) {

        const number = room.choices[playerId];

        count[number] = (count[number] || 0) + 1;
    }

    // Descobre quais jogadores escolheram números únicos
    const uniquePlayers = [];

    for (const playerId in room.choices) {

        const number = room.choices[playerId];

        if (count[number] === 1) {
            uniquePlayers.push(playerId);
        }
    }

    // Regra:
    // Se só 1 jogador escolheu número único, ganha 3 pontos.
    // Se 2 ou mais jogadores escolheram números únicos, cada um ganha 1 ponto.
    if (uniquePlayers.length === 1) {

        const playerId = uniquePlayers[0];

        room.scores[playerId] += 3;
        roundPoints[playerId] = 3;

    } else if (uniquePlayers.length >= 2) {

        uniquePlayers.forEach(playerId => {

            room.scores[playerId] += 1;
            roundPoints[playerId] = 1;
        });
    }

    const scoresWithNames = room.players.map(player => {
        return {
            id: player.id,
            name: player.name,
            choice: room.choices[player.id] ?? null,
            roundPoints: roundPoints[player.id] || 0,
            totalPoints: room.scores[player.id] || 0,
            wonThisRound: roundPoints[player.id] > 0
        };
    });

    io.to(roomCode).emit("roundResult", {
        players: scoresWithNames
    });

    room.round++;

    if (room.round > 5) {

        finishGame(roomCode);

        return;
    }

    room.choices = {};

    setTimeout(() => {
        startRound(roomCode);
    }, 5000);
}

function finishGame(roomCode) {

    const room = rooms[roomCode];

    if (!room) return;

    let winner = null;
    let highestScore = -1;

    room.players.forEach(player => {

        const points = room.scores[player.id] || 0;

        if (points > highestScore) {
            highestScore = points;
            winner = player;
        }
    });

    const finalScores = room.players.map(player => {
        return {
            id: player.id,
            name: player.name,
            points: room.scores[player.id] || 0
        };
    });

    io.to(roomCode).emit("gameFinished", {
        winner: winner ? winner.name : "Sem vencedor",
        scores: finalScores
    });

    setTimeout(() => {
        delete rooms[roomCode];
        console.log(`Sala ${roomCode} removida.`);
    }, 30000);
}

app.post("/register", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.json({
            success: false,
            message: "Preencha usuário e senha"
        });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
        "INSERT INTO users (username, password) VALUES (?, ?)",
        [username, hashedPassword],
        function (err) {
            if (err) {
                return res.json({
                    success: false,
                    message: "Usuário já existe"
                });
            }

            res.json({
                success: true,
                message: "Conta criada com sucesso"
            });
        }
    );
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;

    db.get(
        "SELECT * FROM users WHERE username = ?",
        [username],
        async (err, user) => {
            if (err || !user) {
                return res.json({
                    success: false,
                    message: "Usuário não encontrado"
                });
            }

            const passwordOk = await bcrypt.compare(
                password,
                user.password
            );

            if (!passwordOk) {
                return res.json({
                    success: false,
                    message: "Senha incorreta"
                });
            }

            req.session.user = {
                id: user.id,
                username: user.username
            };

            res.json({
                success: true,
                username: user.username
            });
        }
    );
});

app.get("/me", (req, res) => {
    if (req.session.user) {
        res.json({
            logged: true,
            user: req.session.user
        });
    } else {
        res.json({
            logged: false
        });
    }
});

app.post("/logout", (req, res) => {
    req.session.destroy();

    res.json({
        success: true
    });
});

////////////////////////////
/////CONECXAO///////////////
////////////////////////////
io.on("connection", (socket) => {

    console.log("Jogador conectado:", socket.id);

    socket.on("leaveRoom", (roomCode) => {

    const room = rooms[roomCode];

    if (!room) return;

    const index = room.players.findIndex(
        player => player.id === socket.id
    );

    if (index !== -1) {

        delete room.scores[socket.id];
        delete room.choices[socket.id];

        room.players.splice(index, 1);

        socket.leave(roomCode);

        io.to(roomCode).emit(
            "updatePlayers",
            room.players.map(player => ({
                id: player.id,
                name: player.name,
                isHost: player.id === room.hostId
            }))
        );

        if (room.players.length === 0) {
            delete rooms[roomCode];
            return;
        }

        if (socket.id === room.hostId) {
            room.hostId = room.players[0].id;
        }
    }
});

    socket.on("createRoom", (playerName) => {

        const roomCode = generateRoomCode();


        rooms[roomCode] = {

            code: roomCode,

            hostId: socket.id, // Criador da sala

            players: [],

            scores: {},

            choices: {},

            round: 1,

            gameStarted: false
        };

        rooms[roomCode].players.push({

            id: socket.id,
            name: playerName
        });

        rooms[roomCode].scores[socket.id] = 0;

        socket.join(roomCode);

        socket.emit("roomCreated", roomCode);

        io.to(roomCode).emit(
            "updatePlayers",
            rooms[roomCode].players
        );

        console.log(
            `${playerName} criou a sala ${roomCode}`
        );
    });

    socket.on("joinRoom", ({ roomCode, playerName }) => {

        const room = rooms[roomCode];

        if (!room) {

            socket.emit(
                "errorMessage",
                "Sala não encontrada"
            );

            return;
        }

        if (room.gameStarted) {
    socket.emit(
        "errorMessage",
        "Essa partida já começou"
    );
    return;
}

        if (room.players.length >= 10) {

            socket.emit(
                "errorMessage",
                "Sala cheia"
            );

            return;
        }

        room.players.push({

            id: socket.id,
            name: playerName
        });

        room.scores[socket.id] = 0;

        socket.join(roomCode);

       const playersWithHost = room.players.map(player => ({
    id: player.id,
    name: player.name,
    isHost: player.id === room.hostId
}));

io.to(roomCode).emit(
    "updatePlayers",
    playersWithHost
);

        console.log(
            `${playerName} entrou na sala ${roomCode}`
        );
    });

    socket.on("startGame", (roomCode) => {

        const room = rooms[roomCode];


        if (!room) return;

         // Apenas o host pode iniciar
    if (socket.id !== room.hostId) {

        socket.emit(
            "errorMessage",
            "Somente o criador da sala pode iniciar a partida."
        );

        return;
    }

    if (room.gameStarted) {
    socket.emit("errorMessage", "A partida já foi iniciada.");
    return;
}

        if (room.players.length < 2) {

            socket.emit(
                "errorMessage",
                "É necessário pelo menos 2 jogadores"
            );

            return;
        }

        room.gameStarted = true;

        startRound(roomCode);
    });

    socket.on("chooseNumber", ({ roomCode, number }) => {

    const room = rooms[roomCode];

    if (!room) return;

    if (number < 0 || number > 10) return;

    // Se já escolheu nesta rodada, não pode trocar
    if (room.choices[socket.id] !== undefined) {

        socket.emit(
            "errorMessage",
            "Você já escolheu um número nesta rodada"
        );

        return;
    }

    room.choices[socket.id] = number;

    socket.emit("choiceConfirmed", number);

    console.log(`${socket.id} escolheu ${number}`);
});

    socket.on("disconnect", () => {

        for (const roomCode in rooms) {

            const room = rooms[roomCode];

            const index = room.players.findIndex(
                player => player.id === socket.id
            );

            if (index !== -1) {

                delete room.scores[socket.id];

                delete room.choices[socket.id];

                room.players.splice(index, 1);

                io.to(roomCode).emit(
                    "updatePlayers",
                    room.players
                );

                console.log(
                    `Jogador saiu da sala ${roomCode}`
                );

                if (room.players.length === 0) {

                    delete rooms[roomCode];

                    console.log(
                        `Sala ${roomCode} removida`
                    );
                }

                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Servidor iniciado na porta ${PORT}`);
});