const socket = io();

let currentRoom = "";
let playerName = "";
let alreadyChose = false;
let isLoggedIn = false;

async function registerUser() {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    const response = await fetch("/register", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username,
            password
        })
    });

    const data = await response.json();

    alert(data.message);
}

async function loginUser() {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    const response = await fetch("/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username,
            password
        })
    });

    const data = await response.json();

    if (data.success) {
        playerName = data.username;
        isLoggedIn = true;

        document.getElementById("authArea").style.display = "none";
        document.getElementById("userArea").style.display = "block";

        document.getElementById("loggedUser").innerText =
            "Logado como: " + data.username;
    } else {
        alert(data.message);
    }
}

async function logoutUser() {
    await fetch("/logout", {
        method: "POST"
    });

    location.reload();
}

async function checkLogin() {
    const response = await fetch("/me");
    const data = await response.json();

    if (data.logged) {
        playerName = data.user.username;
        isLoggedIn = true;

        document.getElementById("authArea").style.display = "none";
        document.getElementById("userArea").style.display = "block";

        document.getElementById("loggedUser").innerText =
            "Logado como: " + data.user.username;
    }
}

checkLogin();

// ====================
//ATUALIZAR INTERFACE
// ====================

function updateRoomUI() {

    const inRoom = currentRoom !== "";

    // Elementos que desaparecem ao entrar em uma sala
    document.getElementById("createRoomBtn").style.display =
        inRoom ? "none" : "block";

    document.getElementById("joinRoomBtn").style.display =
        inRoom ? "none" : "block";

    document.getElementById("roomCode").style.display =
        inRoom ? "none" : "block";

    // Botão de sair só aparece quando está em uma sala
    document.getElementById("leaveRoomBtn").style.display =
        inRoom ? "block" : "none";
}

// ====================
// CRIAR SALA
// ====================

function createRoom() {

    if (!isLoggedIn) {
        alert("Você precisa fazer login para criar uma sala.");
        return;
    }

    if (currentRoom !== "") {
        alert("Você já está em uma sala. Saia da sala atual para criar outra.");
        return;
    }

    socket.emit("createRoom", playerName);
}

// ====================
// ENTRAR NA SALA
// ====================

function joinRoom() {

    if (!isLoggedIn) {
        alert("Você precisa fazer login para entrar em uma sala.");
        return;
    }

    if (currentRoom !== "") {
        alert("Você já está em uma sala. Saia da sala atual para entrar em outra.");
        return;
    }

    const roomCode =
        document.getElementById("roomCode").value.toUpperCase();

    if (!roomCode) {
        alert("Digite o código da sala");
        return;
    }

    currentRoom = roomCode;

    updateRoomUI();

    socket.emit("joinRoom", {
        roomCode,
        playerName
    });

    document.getElementById("leaveRoomBtn").style.display = "block";
}


//////////////////
///SAIR DA SALA///
//////////////////

function leaveRoom() {

    if (currentRoom === "") {
        alert("Você não está em nenhuma sala.");
        return;
    }

    socket.emit("leaveRoom", currentRoom);

    document.getElementById("leaveRoomBtn").style.display = "none";

    currentRoom = "";

    document.getElementById("roomInfo").innerText = "Nenhuma sala";
    document.getElementById("roomCode").value = "";
    document.getElementById("playerList").innerHTML = "";
    document.getElementById("results").innerHTML = "";
    document.getElementById("round").innerText = "Rodada 0";
    document.getElementById("timer").innerText = "Tempo: 30";
    document.getElementById("selectedNumber").innerText = "";

    currentRoom = "";

     updateRoomUI();
}

// ====================
// INICIAR PARTIDA
// ====================

function startGame() {

    socket.emit(
        "startGame",
        currentRoom
    );

}

// ====================
// ESCOLHER NÚMERO
// ====================

function chooseNumber(number) {

    if (alreadyChose) {
        alert("Você já escolheu nesta rodada");
        return;
    }

    socket.emit("chooseNumber", {
        roomCode: currentRoom,
        number: number
    });
}

//JA ESCOLHEU O NUMERO, NAO PODE MAIS ESCOLHER

socket.on("choiceConfirmed", (number) => {

    alreadyChose = true;

    document.getElementById("selectedNumber").innerText =
        "Você escolheu: " + number;
});

// ====================
// SALA CRIADA
// ====================

socket.on("roomCreated", (roomCode) => {

    currentRoom = roomCode;

    document.getElementById("roomInfo").innerText =
        "Sala: " + roomCode;

    document.getElementById("roomCode").value = roomCode;

    updateRoomUI();
});

// ====================
// LISTA DE JOGADORES
// ====================

socket.on("updatePlayers", (players) => {

    const playerList = document.getElementById("playerList");

    playerList.innerHTML = "";

    const startButton = document.querySelector(".startBtn");

    players.forEach(player => {

        const li = document.createElement("li");

        li.innerText = player.isHost
            ? `👑 ${player.name}`
            : player.name;

        playerList.appendChild(li);

        // Se este jogador é o host, mostra o botão
        if (player.id === socket.id) {
            startButton.style.display = "block";
        }
    });

    // Se o jogador atual NÃO é o host, esconde o botão
    const souHost = players.some(
        player => player.id === socket.id && player.isHost
    );

    if (!souHost) {
        startButton.style.display = "none";
    }

});

////////////////////////////
//PARTIDA JA EM ANDAMENTO///
////////////////////////////
socket.on("gameStarted", () => {

    const startButton = document.querySelector(".startBtn");

    if (startButton) {
        startButton.style.display = "none";
    }
});

// ====================
// INÍCIO DA RODADA
// ====================

socket.on(
    "roundStarted",
    (data) => {

        document.getElementById(
            "round"
        ).innerText =
            "Rodada " + data.round;

        document.getElementById(
            "selectedNumber"
        ).innerText = "";

        document.getElementById(
            "results"
        ).innerHTML = "";

        alreadyChose = false;
    }
);

// ====================
// TIMER
// ====================

socket.on("timerUpdate", (time) => {

    document.getElementById("timer").innerText =
        "Tempo: " + time;

    const tickSound = document.getElementById("tickSound");

    if (tickSound && time > 0) {
        tickSound.currentTime = 0;
        tickSound.play().catch(() => {});
    }
});

// ====================
// RESULTADO DA RODADA
// ====================

socket.on("roundResult", (data) => {

    const results = document.getElementById("results");

    results.innerHTML = "<h3>Resultado da Rodada</h3>";

    data.players.forEach(player => {

        results.innerHTML += `
            <p>
                <strong>${player.name}</strong><br>
                Escolheu: ${player.choice}<br>
                Ganhou nesta rodada: +${player.roundPoints} ponto(s)<br>
                Total: ${player.totalPoints} ponto(s)
            </p>
        `;
    });

});

// ====================
// FIM DA PARTIDA
// ====================

socket.on("gameFinished", (data) => {

    const results = document.getElementById("results");

    results.innerHTML = "<h2>Fim da Partida</h2>";

    results.innerHTML +=
        `<h3>🏆 Vencedor: ${data.winner}</h3>`;

    results.innerHTML += "<h3>Placar Final</h3>";

    data.scores.forEach(player => {
        results.innerHTML +=
            `<p>${player.name}: ${player.points} ponto(s)</p>`;
    });
});

// ====================
// ERROS
// ====================

socket.on(
    "errorMessage",
    (message) => {

        alert(message);
    }
);

updateRoomUI();