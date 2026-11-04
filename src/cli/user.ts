// Gestion des comptes utilisateurs, en ligne de commande uniquement :
// bun run user add <nom> | reset <nom> | rename <nom> <nouveau> | list
import { generatePassword, hashPassword, validUserName } from "../auth.ts";
import { openStore } from "../store.ts";

const USAGE = `Usage :
  bun run user add <nom>                crée un compte ; affiche un mot de passe temporaire
  bun run user reset <nom>              nouveau mot de passe temporaire, sessions révoquées
  bun run user rename <nom> <nouveau>   change l'identifiant
  bun run user list                     liste les comptes`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const [command, name, newName] = process.argv.slice(2);
const store = openStore(process.env.DB_PATH ?? "data/finance.sqlite");
const existing = (n: string) => store.userByName(n) ?? fail(`Compte « ${n} » introuvable.`);
const available = (n: string) => {
  if (!validUserName(n)) fail("Identifiant invalide : 1 à 64 caractères, lettres sans accent, chiffres, - _ . seulement.");
  if (store.userByName(n)) fail(`Le compte « ${n} » existe déjà.`);
};

// Le mot de passe temporaire ne va que sur le terminal de celui qui lance la commande.
const showPassword = (password: string) => console.log(`Mot de passe temporaire (à changer à la première connexion) : ${password}`);

if (command === "add" && name) {
  available(name);
  const password = generatePassword();
  store.addUser(name, await hashPassword(password));
  console.log(`Compte « ${name} » créé.`);
  showPassword(password);
} else if (command === "reset" && name) {
  const user = existing(name);
  const password = generatePassword();
  store.setPassword(user.id, await hashPassword(password), true);
  console.log(`Compte « ${user.name} » réinitialisé, sessions révoquées.`);
  showPassword(password);
} else if (command === "rename" && name && newName) {
  const user = existing(name);
  available(newName);
  store.renameUser(user.id, newName);
  console.log(`Compte « ${user.name} » renommé en « ${newName} ».`);
} else if (command === "list") {
  for (const user of store.users()) console.log(user.name);
} else {
  fail(USAGE);
}
