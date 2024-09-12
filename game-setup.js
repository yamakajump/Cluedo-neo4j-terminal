const readlineSync = require('readline-sync');

// Variable de configuration pour activer/désactiver les logs
const enableLogs = false; // Mettre à false pour désactiver les logs

// Liste des personnages disponibles
const allCharacters = [
    'Mr. Adam',
    'Mr. Godin',
    'Mr. Kerbellec',
    'Mr. Kamp',
    'Mr. Pham',
    'Mr. Baudon',
    'Mrs. Rault'
];

// Liste des armes disponibles
const weapons = ['A boule', 'Pain au chocolat', 'Babyfoot', 'Le plat sans viande', 'Pc gameur', 'Velleda', 'DDOS', 'Cours de Kermebellec'];

// Liste des pièces disponibles
const rooms = ['RU', 'BU', 'Cafétéria', 'Amphi A', 'Amphi B', 'Amphi C', 'Secrétariat', 'Salle des profs', 'Imprimerie'];

async function setupGame(driver) {
    const session = driver.session();

    try {
        // Étape 1 : Vider la base de données (supprimer tous les nœuds et relations)
        log("Réinitialisation de la base de données...");
        await session.run('MATCH (n) DETACH DELETE n');
        log("Base de données réinitialisée.");

        // Étape 2 : Demander le nombre de joueurs humains avec validation
        const maxPlayers = allCharacters.length;
        let numHumanPlayers = 0;
        
        console.clear();
        // Demander le nombre de joueurs humains
        while (numHumanPlayers < 1 || numHumanPlayers > maxPlayers) {
            numHumanPlayers = readlineSync.questionInt(`Combien y a-t-il de joueurs humains ? (Entre 1 et ${maxPlayers}) : `);
            if (numHumanPlayers < 1) {
                log("Il doit y avoir au moins 1 joueur humain.");
            } else if (numHumanPlayers > maxPlayers) {
                log(`Le nombre de joueurs humains ne peut pas dépasser ${maxPlayers}.`);
            }
        }

        // Demander le nombre de bots, tout en s'assurant que le total (humains + bots) soit entre 2 et maxPlayers
        let numBots = 0;
        const availableSlotsForBots = maxPlayers - numHumanPlayers;
        const minTotalPlayers = 2;
        const maxTotalPlayers = maxPlayers;

        console.clear();
        // Construire un message dynamique pour le nombre de bots
        while (true) {
            let botMessage = `Combien de bots voulez-vous ? (Entre 0 et ${availableSlotsForBots}) : `;
            
            // Si seulement 1 joueur humain, un bot est obligatoire
            if (numHumanPlayers === 1) {
                botMessage = `Combien de bots voulez-vous ? (Entre 1 et ${availableSlotsForBots}) : `;
            }
            
            numBots = readlineSync.questionInt(botMessage);
            const totalPlayers = numHumanPlayers + numBots;

            if (totalPlayers < minTotalPlayers) {
                log(`Il doit y avoir au moins ${minTotalPlayers} joueurs (humains + bots).`);
            } else if (totalPlayers > maxTotalPlayers) {
                log(`Le total de joueurs ne peut pas dépasser ${maxTotalPlayers}.`);
            } else if (numHumanPlayers === 1 && numBots < 1) {
                log('Il faut au moins un bot si vous êtes le seul joueur humain.');
            } else {
                break;
            }
        }

        // Saisie des noms des joueurs humains et sélection des personnages
        const players = [];
        const remainingCharacters = [...allCharacters];  // Liste des personnages à distribuer

        for (let i = 0; i < numHumanPlayers; i++) {
            console.clear();
            let playerName = '';

            // Valider le nom du joueur : entre 4 et 16 caractères, et non déjà pris
            while (true) {
                playerName = readlineSync.question(`Nom du joueur ${i + 1} (4 à 16 caractères, unique) : `);

                if (playerName.length < 4 || playerName.length > 16) {
                    log('Le nom doit contenir entre 4 et 16 caractères.');
                } else if (players.some(player => player.name === playerName)) {
                    log('Ce nom est déjà pris. Veuillez en choisir un autre.');
                } else {
                    break;
                }
            }

            log(`Sélectionnez un personnage pour incarner ${playerName}`);
            
            let selectedCharacter = '';
            while (remainingCharacters.length > 0) {
                const index = readlineSync.keyInSelect(remainingCharacters, 'Choisissez un personnage :', { cancel: false });
                if (index !== -1) {
                    selectedCharacter = remainingCharacters[index];
                    remainingCharacters.splice(index, 1);  // Supprime le personnage sélectionné de la liste
                    break;
                } else {
                    log('Sélection annulée ou invalide. Veuillez réessayer.');
                }
            }

            players.push({ name: playerName, character: selectedCharacter, type: 'humain' });
        }

        // Ajouter les bots avec des noms prédéfinis et des personnages restants
        for (let i = 0; i < numBots; i++) {
            const botName = `Bot ${i + 1}`;
            const botCharacter = remainingCharacters.shift(); // Sélectionne un personnage restant pour le bot
            players.push({ name: botName, character: botCharacter, type: 'bot' });
            log(`${botName} incarnera ${botCharacter}`);
        }

        // Étape 3 : Initialiser les nœuds dans la base de données

        // Créer les nœuds pour les personnages, armes et pièces dans Neo4j
        const transaction = session.beginTransaction();
        try {
            // Créer les armes et pièces restantes
            for (let weapon of weapons) {
                await transaction.run(
                    `CREATE (:Arme {name: $weapon})`,
                    { weapon: weapon }
                );
            }

            for (let room of rooms) {
                await transaction.run(
                    `CREATE (:Pièce {name: $room})`,
                    { room: room }
                );
            }

            // Créer les joueurs (humains et bots) et leurs personnages incarnés
            for (let player of players) {
                await transaction.run(
                    `MATCH (c:Pièce {name: 'Cafétéria'})
                     CREATE (j:Joueur {name: $name, type: $type})-[:INCARNE]->(p:Personnage {name: $character}),
                            (j)-[:EST_DANS]->(c)`,
                    { name: player.name, character: player.character, type: player.type }
                );
            }

            // Créer les personnages restants comme nœuds dans la base Neo4j
            for (let character of remainingCharacters) {
                await transaction.run(
                    `CREATE (:Personnage {name: $character})`,
                    { character: character }
                );
            }

            await transaction.commit();
            log('Joueurs, personnages, armes, et pièces créés avec succès.');
        } catch (err) {
            console.error('Erreur lors de l\'insertion des éléments dans la base de données :', err);
            await transaction.rollback();
        }

        // Étape 4 : Sélectionner la solution du meurtre (meurtrier, arme, pièce)
        const murderer = chooseRandom(allCharacters);
        const weapon = chooseRandom(weapons);
        const room = chooseRandom(rooms);

        log(`Le meurtre a été commis par ${murderer} dans la ${room} avec le ${weapon}.`);

        // Enregistrer les relations de la solution dans la base de données
        const solutionTransaction = session.beginTransaction();
        try {
            // Créer les relations entre le meurtrier, l'arme et la pièce dans Neo4j
            await solutionTransaction.run(
                `MATCH (p:Personnage {name: $murderer}), (r:Pièce {name: $room}), (a:Arme {name: $weapon})
                 CREATE (p)-[:A_TUE_DANS]->(r),
                        (p)-[:A_UTILISE]->(a)`,
                { murderer: murderer, weapon: weapon, room: room }
            );
            await solutionTransaction.commit();
            log('Relations du meurtre enregistrées dans la base de données.');
        } catch (err) {
            console.error('Erreur lors de l\'enregistrement des relations de la solution dans la base de données :', err);
            await solutionTransaction.rollback();
        }

        // Retirer les cartes de la solution de la distribution
        removeElement(allCharacters, murderer);
        removeElement(weapons, weapon);
        removeElement(rooms, room);

        // Étape 5 : Distribuer les personnages, armes et pièces restants entre les joueurs
        const allElements = [...allCharacters, ...weapons, ...rooms];
        shuffleArray(allElements);  // Mélanger les éléments
        
        const cardTransaction = session.beginTransaction();
        let currentPlayerIndex = 0;
        try {
            for (let element of allElements) {
                const player = players[currentPlayerIndex];
                await cardTransaction.run(
                    `MATCH (j:Joueur {name: $name}) 
                     MATCH (e {name: $element}) 
                     CREATE (j)-[:POSSEDE]->(e)`,
                    { name: player.name, element: element }
                );
                currentPlayerIndex = (currentPlayerIndex + 1) % (numHumanPlayers + numBots);
            }
            await cardTransaction.commit();
            log('Distribution des personnages, armes et pièces terminée.');
        } catch (error) {
            console.error('Erreur lors de la distribution des éléments :', error);
            await cardTransaction.rollback();
        }

        // Étape 6 : Créer les relations d'accès entre les salles
        const roomRelations = [
            { from: 'RU', to: ['Cafétéria', 'Amphi B'] },
            { from: 'BU', to: ['Cafétéria', 'Amphi C'] },
            { from: 'Cafétéria', to: ['Secrétariat', 'Amphi A', 'RU', 'BU', 'Imprimerie'] },
            { from: 'Amphi A', to: ['Cafétéria', 'Secrétariat', 'Salle des profs'] },
            { from: 'Amphi B', to: ['RU', 'Cafétéria', 'BU', 'Amphi C'] },
            { from: 'Amphi C', to: ['Amphi B', 'BU'] },
            { from: 'Secrétariat', to: ['Salle des profs', 'Amphi A', 'Cafétéria'] },
            { from: 'Salle des profs', to: ['Amphi A', 'Secrétariat'] },
            { from: 'Imprimerie', to: ['Cafétéria'] }
        ];

        const relationTransaction = session.beginTransaction();
        try {
            for (let relation of roomRelations) {
                for (let targetRoom of relation.to) {
                    await relationTransaction.run(
                        `MATCH (r1:Pièce {name: $from}), (r2:Pièce {name: $to})
                         CREATE (r1)-[:A_ACCES]->(r2)`,
                        { from: relation.from, to: targetRoom }
                    );
                }
            }
            await relationTransaction.commit();
            log('Relations d\'accès entre les salles créées avec succès.');
        } catch (err) {
            console.error('Erreur lors de la création des relations d\'accès entre les salles :', err);
            await relationTransaction.rollback();
        }

    } catch (error) {
        console.error('Erreur lors de l\'initialisation du jeu :', error);
    } finally {
        session.close();
    }
}

// Fonction utilitaire pour afficher les logs si enableLogs est activé
function log(message) {
    if (enableLogs) {
        console.log(message);
    }
}

// Fonction utilitaire pour mélanger les éléments
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// Fonction pour sélectionner un élément aléatoire dans une liste
function chooseRandom(array) {
    const index = Math.floor(Math.random() * array.length);
    return array[index];
}

// Fonction pour retirer un élément d'une liste
function removeElement(array, element) {
    const index = array.indexOf(element);
    if (index > -1) {
        array.splice(index, 1);
    }
}

module.exports = { setupGame };
