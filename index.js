const { initializeNeo4j } = require('./neo4j-setup');
const { setupGame } = require('./game-setup');
const { executeGame } = require('./game-execution');

// Initialiser Neo4j
const driver = initializeNeo4j();

// Démarrer l'initialisation du jeu
setupGame(driver).then(() => {
    // Exécuter le jeu
    executeGame(driver);
});
