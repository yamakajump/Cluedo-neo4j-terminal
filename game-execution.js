const readlineSync = require('readline-sync');

async function executeGame(driver) {
    const session = driver.session();

    try {
        // Récupérer les joueurs
        const players = await getPlayers(session);

        // Récupérer toutes les cartes (Personnages, Armes, Pièces)
        const allCharacters = await getElements(session, 'Personnage');
        const allWeapons = await getElements(session, 'Arme');
        const allRooms = await getElements(session, 'Pièce');

        // Variables pour garder la trace des hypothèses déjà faites par les bots
        const botMemory = {};
        let currentPlayerIndex = 0;

        while (true) { // Boucle infinie pour les tours
            const currentPlayer = players[currentPlayerIndex];
            // Étape 1 : Déplacement du joueur (automatisé pour les bots)
            const currentRoom = await getCurrentRoom(session, currentPlayer.name);
            const newRoom = currentPlayer.type === 'bot'
                ? await handleBotMovement(session, currentPlayer, currentRoom)
                : await handleMovement(session, currentPlayer, currentRoom, players, allCharacters, allWeapons, allRooms);

            // Étape 2 : Faire une hypothèse (automatisé pour les bots)
            const { selectedWeapon, selectedCharacter } = currentPlayer.type === 'bot'
                ? await makeBotHypothesis(session, currentPlayer, newRoom)
                : await makeHypothesis(session, currentPlayer, newRoom, players, allCharacters, allWeapons, allRooms); // Passer les cartes ici

            // Étape 3 : Choisir un joueur à interroger (automatisé pour les bots)
            const selectedPlayer = currentPlayer.type === 'bot'
                ? await choosePlayerForBot(session, players, currentPlayerIndex)
                : await choosePlayerToAsk(session, currentPlayer, players, currentPlayerIndex);

            // Étape 4 : Révéler une carte ou mémoriser pour les bots
            await handleHypothesis(session, currentPlayer, selectedPlayer, selectedWeapon, selectedCharacter, newRoom, botMemory);

            // Si le joueur est un bot on laisse le temps de lire
            readlineSync.question('Appuyez sur Entrée pour passer au prochain joueur...');
            console.clear();

            // Passer au joueur suivant
            currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
        }
    } catch (error) {
        console.error('Erreur pendant l\'exécution du jeu :', error);
    } finally {
        session.close();
    }
}


async function getPlayers(session) {
    const playersResult = await session.run('MATCH (j:Joueur) RETURN j ORDER BY ID(j)');
    return playersResult.records.map(record => record.get('j').properties);
}

async function getCurrentRoom(session, playerName) {
    const currentRoomResult = await session.run(
        `MATCH (j:Joueur {name: $name})-[:EST_DANS]->(r:Pièce) RETURN r`,
        { name: playerName }
    );
    return currentRoomResult.records[0].get('r').properties.name;
}

async function displayPlayerCards(session, player) {
    console.clear(); // Effacer la console pour préserver la confidentialité

    const playerCardsResult = await session.run(
        `MATCH (j:Joueur {name: $name})-[:POSSEDE]->(c) RETURN c`,
        { name: player.name }
    );
    const playerCards = playerCardsResult.records.map(record => record.get('c').properties.name);

    // Trier les cartes par ordre Personnage, Salle, Arme
    const sortedCards = sortCardsByCategory(playerCards);
    console.table(sortedCards);

    readlineSync.question('Appuyez sur Entrée pour continuer...');
    console.clear(); // Effacer à nouveau la console avant de reprendre le jeu
}

function sortCardsByCategory(cards) {
    const characters = [];
    const rooms = [];
    const weapons = [];

    cards.forEach(card => {
        if (isCharacter(card)) characters.push(card);
        else if (isRoom(card)) rooms.push(card);
        else weapons.push(card);
    });

    return {
        Personnages: characters,
        Pièces: rooms,
        Armes: weapons
    };
}

function isCharacter(card) {
    const knownCharacters = [
        'Mr. Adam', 'Mr. Godin', 'Mr. Kerbellec', 'Mr. Kamp', 'Mr. Pham', 'Mr. Baudon', 'Mrs. Rault'
    ];
    return knownCharacters.includes(card);
}

function isRoom(card) {
    const knownRooms = [
        'RU', 'BU', 'Cafétéria', 'Amphi A', 'Amphi B', 'Amphi C', 'Secrétariat', 'Salle des profs', 'Imprimerie'
    ];
    return knownRooms.includes(card);
}

async function handleMovement(session, player, currentRoom, players, allCharacters, allWeapons, allRooms) {
    console.clear();
    console.log(`C'est au tour de ${player.name} (${player.type}).`);
    console.log(`${player.name} est actuellement dans la pièce ${currentRoom}.`);

    const availableRoomsResult = await session.run(
        `MATCH (r1:Pièce {name: $currentRoom})-[:A_ACCES]->(r2:Pièce) RETURN r2`,
        { currentRoom: currentRoom }
    );
    const availableRooms = availableRoomsResult.records.map(record => record.get('r2').properties.name);

    while (true) {
        const extendedOptions = ['Voir mes cartes', 'Voir mon carnet de détective', ...availableRooms];
        const choice = readlineSync.keyInSelect(
            extendedOptions,
            'Choisissez une pièce où aller ou consultez vos informations :',
            { cancel: false }
        );

        if (choice === 0) {
            // Voir les cartes du joueur
            await displayPlayerCards(session, player);
        } else if (choice === 1) {
            // Voir le carnet de détective
            const notebook = await getDetectiveNotebook(session, player, players);
            displayDetectiveNotebook(notebook, player, players, allCharacters, allWeapons, allRooms);
        } else {
            // Si le joueur a choisi une pièce
            const newRoom = availableRooms[choice - 2];  // Ajuster l'index car 2 options ont été ajoutées
            await session.run(
                `MATCH (j:Joueur {name: $name})-[r:EST_DANS]->(oldRoom:Pièce), (newRoom:Pièce {name: $newRoom})
                 DELETE r
                 CREATE (j)-[:EST_DANS]->(newRoom)`,
                { name: player.name, newRoom: newRoom }
            );
            console.log(`${player.name} a changé de pièce pour aller dans ${newRoom}.`);
            return newRoom;
        }
    }
}


async function handleBotMovement(session, player, currentRoom) {
    const availableRoomsResult = await session.run(
        `MATCH (r1:Pièce {name: $currentRoom})-[:A_ACCES]->(r2:Pièce) RETURN r2`,
        { currentRoom: currentRoom }
    );
    const availableRooms = availableRoomsResult.records.map(record => record.get('r2').properties.name);

    const randomIndex = Math.floor(Math.random() * availableRooms.length);
    const newRoom = availableRooms[randomIndex];

    await session.run(
        `MATCH (j:Joueur {name: $name})-[r:EST_DANS]->(oldRoom:Pièce), (newRoom:Pièce {name: $newRoom})
         DELETE r
         CREATE (j)-[:EST_DANS]->(newRoom)`,
        { name: player.name, newRoom: newRoom }
    );
    console.log(`${player.name} (bot) a changé de pièce pour aller dans ${newRoom}.`);
    return newRoom;
}

async function makeHypothesis(session, player, room, players, allCharacters, allWeapons, allRooms) {
    console.clear();
    console.log(`C'est au tour de ${player.name} (${player.type}).`);

    const weapons = await getElements(session, 'Arme');
    const characters = await getElements(session, 'Personnage');

    // Utilisation de la fonction modifiée
    const selectedWeapon = await makeChoiceWithCardsOption(session, player, weapons, 'Sélectionnez une arme pour votre hypothèse :', players, allCharacters, allWeapons, allRooms);
    const selectedCharacter = await makeChoiceWithCardsOption(session, player, characters, 'Sélectionnez un personnage pour votre hypothèse :', players, allCharacters, allWeapons, allRooms);

    console.log(`${player.name} fait l'hypothèse que ${selectedCharacter} a utilisé ${selectedWeapon} dans la pièce ${room}.`);

    return { selectedWeapon, selectedCharacter };
}


async function makeBotHypothesis(session, player, room) {
    const weapons = await getElements(session, 'Arme');
    const characters = await getElements(session, 'Personnage');

    const remainingWeapons = await filterKnownPossessions(session, player.name, weapons, 'Arme');
    const remainingCharacters = await filterKnownPossessions(session, player.name, characters, 'Personnage');

    const selectedWeapon = remainingWeapons[Math.floor(Math.random() * remainingWeapons.length)];
    const selectedCharacter = remainingCharacters[Math.floor(Math.random() * remainingCharacters.length)];

    console.log(`${player.name} (bot) fait l'hypothèse que ${selectedCharacter} a utilisé ${selectedWeapon} dans la pièce ${room}.`);

    return { selectedWeapon, selectedCharacter };
}

async function filterKnownPossessions(session, playerName, items, type) {
    const result = await session.run(
        `MATCH (j:Joueur {name: $playerName})-[:PENSE_QUE_POSSEDE]->(c:${type}) RETURN c.name`,
        { playerName: playerName }
    );
    const knownItems = result.records.map(record => record.get('c.name'));
    return items.filter(item => !knownItems.includes(item));
}

async function makeChoiceWithCardsOption(session, player, options, message, players, allCharacters, allWeapons, allRooms) {
    console.clear();
    console.log(`C'est au tour de ${player.name} (${player.type}).`);
    while (true) {
        const extendedOptions = ['Voir mes cartes', 'Voir mon carnet de détective', ...options];
        const choice = readlineSync.keyInSelect(extendedOptions, message, { cancel: false });

        if (choice === 0) {
            await displayPlayerCards(session, player);  // Voir les cartes du joueur
        } else if (choice === 1) {
            const notebook = await getDetectiveNotebook(session, player, players); // Récupérer le carnet de détective
            displayDetectiveNotebook(notebook, player, players, allCharacters, allWeapons, allRooms);  // Afficher le carnet
        } else {
            return options[choice - 2];  // Retourner l'option choisie (décalage car on a ajouté 2 options)
        }
    }
}


async function choosePlayerToAsk(session, currentPlayer, players, currentPlayerIndex) {
    console.clear();
    console.log(`C'est au tour de ${currentPlayer.name} (${currentPlayer.type}).`);

    const otherPlayers = players.filter((_, index) => index !== currentPlayerIndex);
    const playerNames = otherPlayers.map(player => player.name);
    const choice = readlineSync.keyInSelect(playerNames, 'Choisissez à quel joueur poser la question :', { cancel: false });

    const selectedPlayer = otherPlayers[choice];
    console.log(`${currentPlayer.name} pose une question à ${selectedPlayer.name}.`);
    return selectedPlayer;
}

async function choosePlayerForBot(session, players, currentPlayerIndex) {
    const otherPlayers = players.filter((_, index) => index !== currentPlayerIndex);

    const randomIndex = Math.floor(Math.random() * otherPlayers.length);
    const selectedPlayer = otherPlayers[randomIndex];

    console.log(`Le bot pose une question à ${selectedPlayer.name}.`);
    return selectedPlayer;
}

async function handleHypothesis(session, currentPlayer, selectedPlayer, selectedWeapon, selectedCharacter, room, botMemory) {
    let cardRevealed = false;

    if (selectedPlayer.type === 'bot') {
        if (!botMemory[selectedPlayer.name]) botMemory[selectedPlayer.name] = [];

        const botMemoryKey = `${selectedCharacter}-${selectedWeapon}-${room}`;
        if (botMemory[selectedPlayer.name].includes(botMemoryKey)) {
            console.log(`${selectedPlayer.name} a déjà répondu à cette hypothèse dans cette salle.`);
            return;
        } else {
            botMemory[selectedPlayer.name].push(botMemoryKey);
        }
    }

    const cardsToReveal = await checkPlayerCards(session, currentPlayer, selectedPlayer, selectedCharacter, selectedWeapon);

    if (cardsToReveal.length > 0) {
        if (selectedPlayer.type === 'bot') {
            const revealedCard = await handleBotCardReveal(session, currentPlayer, selectedPlayer, cardsToReveal);
            console.log(`${selectedPlayer.name} (bot) montre la carte ${revealedCard}.`);
            await createPossessionLink(session, currentPlayer.name, selectedPlayer.name, revealedCard);
        } else {
            readlineSync.question(`${selectedPlayer.name} doit montrer une de ses cartes.\nAppuyez sur Entrée pour continuer...`);
            console.clear();

            const cardChoice = readlineSync.keyInSelect(cardsToReveal, `${selectedPlayer.name} possède plusieurs cartes, laquelle voulez-vous montrer ?`, { cancel: false });
            const revealedCard = cardsToReveal[cardChoice];
            console.log(`${selectedPlayer.name} montre la carte ${revealedCard}.`);
            await createPossessionLink(session, currentPlayer.name, selectedPlayer.name, revealedCard);
        }
        cardRevealed = true;
    } else {
        // Si aucune carte n'est montrée, enregistrer que le joueur sélectionné ne possède pas les cartes dans l'hypothèse
        await recordNoCardPossession(session, currentPlayer, selectedPlayer, selectedWeapon, selectedCharacter, room);
    }

    if (!cardRevealed) {
        console.log(`${selectedPlayer.name} n'a montré aucune carte.`);
    }
}

async function recordNoCardPossession(session, currentPlayer, selectedPlayer, weapon, character, room) {
    // Enregistrer que le joueur interrogé ne possède pas les cartes dans l'hypothèse
    await session.run(
        `MATCH (j:Joueur {name: $currentPlayer})
         MERGE (j)-[:PENSE_QUE_NE_POSSEDE_PAS {par: $selectedPlayer}]->(weapon:Arme {name: $weapon})
         MERGE (j)-[:PENSE_QUE_NE_POSSEDE_PAS {par: $selectedPlayer}]->(character:Personnage {name: $character})
         MERGE (j)-[:PENSE_QUE_NE_POSSEDE_PAS {par: $selectedPlayer}]->(room:Pièce {name: $room})`,
        {
            currentPlayer: currentPlayer.name,
            selectedPlayer: selectedPlayer.name, // Ajoutez le joueur qui a été interrogé
            weapon: weapon,
            character: character,
            room: room
        }
    );

    console.log(`${currentPlayer.name} a enregistré que ${selectedPlayer.name} ne possède pas ${weapon}, ${character}, et ${room}.`);
}



async function handleBotCardReveal(session, currentPlayer, bot, cardsToReveal) {
    const previousCardResult = await session.run(
        `MATCH (j:Joueur {name: $botName})-[:PENSE_QUE_POSSEDE]->(c:Carte) RETURN c.name`,
        { botName: bot.name }
    );
    const previousCards = previousCardResult.records.map(record => record.get('c.name'));

    const commonCards = cardsToReveal.filter(card => previousCards.includes(card));

    if (commonCards.length > 0) {
        return commonCards[0];
    } else {
        const randomIndex = Math.floor(Math.random() * cardsToReveal.length);
        return cardsToReveal[randomIndex];
    }
}

async function checkPlayerCards(session, currentPlayer, nextPlayer, selectedCharacter, selectedWeapon) {
    const cardsToReveal = [];

    const characterCardResult = await session.run(
        `MATCH (j:Joueur {name: $nextPlayer})-[:POSSEDE]->(c {name: $card})
         RETURN c`,
        { nextPlayer: nextPlayer.name, card: selectedCharacter }
    );
    if (characterCardResult.records.length > 0) {
        cardsToReveal.push(characterCardResult.records[0].get('c').properties.name);
    }

    const weaponCardResult = await session.run(
        `MATCH (j:Joueur {name: $nextPlayer})-[:POSSEDE]->(c {name: $card})
         RETURN c`,
        { nextPlayer: nextPlayer.name, card: selectedWeapon }
    );
    if (weaponCardResult.records.length > 0) {
        cardsToReveal.push(weaponCardResult.records[0].get('c').properties.name);
    }

    return cardsToReveal;
}

async function createPossessionLink(session, currentPlayerName, nextPlayerName, revealedCard) {
    await session.run(
        `MATCH (j1:Joueur {name: $currentPlayer}), (c {name: $revealedCard})
         CREATE (j1)-[:PENSE_QUE_POSSEDE {par: $nextPlayer}]->(c)`,
        {
            currentPlayer: currentPlayerName,
            nextPlayer: nextPlayerName,
            revealedCard: revealedCard
        }
    );
}

async function getElements(session, type) {
    const result = await session.run(`MATCH (e:${type}) RETURN e.name`);
    return result.records.map(record => record.get('e.name'));
}

async function getDetectiveNotebook(session, currentPlayer, players) {
    const notebook = {};

    // Obtenez les cartes possédées par le joueur courant
    const playerCardsResult = await session.run(
        `MATCH (j:Joueur {name: $name})-[:POSSEDE]->(c) RETURN c.name AS cardName, labels(c)[0] AS cardType`,
        { name: currentPlayer.name }
    );
    const playerCards = playerCardsResult.records.reduce((acc, record) => {
        acc[record.get('cardName')] = '✔';
        return acc;
    }, {});

    // Obtenez les possessions connues des autres joueurs
    for (const player of players) {
        if (player.name !== currentPlayer.name) {
            notebook[player.name] = {
                characters: await getKnownPossessions(session, currentPlayer, player, 'Personnage'),
                weapons: await getKnownPossessions(session, currentPlayer, player, 'Arme'),
                rooms: await getKnownPossessions(session, currentPlayer, player, 'Pièce')
            };
        }
    }

    return {
        playerCards, // Ajoutez les cartes possédées par le joueur courant
        notebook
    };
}


async function getKnownPossessions(session, currentPlayer, otherPlayer, type) {
    const possessionResult = await session.run(
        `MATCH (j:Joueur {name: $currentPlayer})-[rel:PENSE_QUE_POSSEDE|PENSE_QUE_NE_POSSEDE_PAS]->(c:${type})
         WHERE rel.par = $otherPlayer
         RETURN c.name, type(rel) AS relationType`,
        { currentPlayer: currentPlayer.name, otherPlayer: otherPlayer.name }
    );

    const knownPossessions = {};
    possessionResult.records.forEach(record => {
        knownPossessions[record.get('c.name')] = record.get('relationType') === 'PENSE_QUE_POSSEDE' ? '✔' : '✘';
    });

    return knownPossessions;
}


function displayDetectiveNotebook(notebookData, currentPlayer, players, allCharacters, allWeapons, allRooms) {
    console.clear(); // Effacer la console pour afficher le carnet de détective

    const table = {}; // Utiliser un objet pour structurer correctement les données

    // Ajouter la catégorie "Personnages"
    table['Personnages'] = players.reduce((acc, player) => ({ ...acc, [player.name]: '' }), {});

    // Ajouter les personnages
    for (const character of allCharacters) {
        table[character] = {};
        for (const player of players) {
            if (notebookData.notebook[player.name]?.characters?.[character]) {
                table[character][player.name] = notebookData.notebook[player.name].characters[character];
            } else {
                table[character][player.name] = ''; // Si aucune information, laisser vide
            }
        }
        // Ajouter les cartes possédées par le joueur courant
        if (notebookData.playerCards[character]) {
            table[character][currentPlayer.name] = notebookData.playerCards[character];
        }
    }

    // Ajouter une ligne vide pour séparer les catégories
    table[' '] = players.reduce((acc, player) => ({ ...acc, [player.name]: '' }), {});

    // Ajouter la catégorie "Armes"
    table['Armes'] = players.reduce((acc, player) => ({ ...acc, [player.name]: '' }), {});

    // Ajouter les armes
    for (const weapon of allWeapons) {
        table[weapon] = {};
        for (const player of players) {
            if (notebookData.notebook[player.name]?.weapons?.[weapon]) {
                table[weapon][player.name] = notebookData.notebook[player.name].weapons[weapon];
            } else {
                table[weapon][player.name] = '';
            }
        }
        // Ajouter les cartes possédées par le joueur courant
        if (notebookData.playerCards[weapon]) {
            table[weapon][currentPlayer.name] = notebookData.playerCards[weapon];
        }
    }

    // Ajouter une autre ligne vide pour séparer les catégories
    table['  '] = players.reduce((acc, player) => ({ ...acc, [player.name]: '' }), {});

    // Ajouter la catégorie "Pièces"
    table['Pièces'] = players.reduce((acc, player) => ({ ...acc, [player.name]: '' }), {});

    // Ajouter les pièces
    for (const room of allRooms) {
        table[room] = {};
        for (const player of players) {
            if (notebookData.notebook[player.name]?.rooms?.[room]) {
                table[room][player.name] = notebookData.notebook[player.name].rooms[room];
            } else {
                table[room][player.name] = '';
            }
        }
        // Ajouter les cartes possédées par le joueur courant
        if (notebookData.playerCards[room]) {
            table[room][currentPlayer.name] = notebookData.playerCards[room];
        }
    }

    // Afficher la table avec console.table
    console.table(table);

    readlineSync.question('Appuyez sur Entrée pour continuer...');
    console.clear(); // Effacer la console après consultation du carnet
}

module.exports = { executeGame };
