import { createInterface } from 'node:readline/promises';
import { openDatabase, collections } from '../server/db.js';
import { hashPassword } from '../server/passwords.js';

/**
 * Run once, by hand: there is no registration screen and there is not going
 * to be one. The password is asked for rather than taken as an argument,
 * because an argument lands in the shell history in the clear.
 */
async function main(): Promise<void> {
  const url = process.env.MONGO_URL;
  const dbName = process.env.MONGO_DB;
  if (!url || !dbName) throw new Error('Set MONGO_URL and MONGO_DB first');

  const ask = createInterface({ input: process.stdin, output: process.stdout });
  const username = await ask.question('username: ');
  const password = await ask.question('password: ');
  ask.close();

  if (password.length < 12) throw new Error('Use at least 12 characters');

  const db = await openDatabase(url, dbName);
  await collections(db).users.insertOne({
    username,
    passwordHash: await hashPassword(password),
  });
  console.log(`created ${username}`);
  process.exit(0);
}

// Awaited, not fired and forgotten: on a pipe the process could otherwise print both
// prompts and exit 0 without ever inserting the row. This file is ESM, so top-level
// await is available.
await main();
