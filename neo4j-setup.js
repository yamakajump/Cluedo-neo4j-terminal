const neo4j = require('neo4j-driver');

const uri = 'bolt://localhost:7687';  // URL de Neo4j
const user = 'neo4j';                 // Nom d'utilisateur
const password = 'cluedoneo4j';       // Mot de passe Neo4j

function initializeNeo4j() {
    const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    console.log('Connexion à Neo4j réussie');
    return driver;
}

module.exports = { initializeNeo4j };
