import { migrate, openDatabase, seedDemo, G1_DATABASE_URL } from "./index.js";
const url = process.env.G1_DATABASE_URL ?? G1_DATABASE_URL;
const command = process.argv[2];
if (command === "migrate")
  console.log(JSON.stringify(await migrate(url), null, 2));
else if (command === "seed") {
  const connection = openDatabase(url);
  try {
    console.log(JSON.stringify(await seedDemo(connection), null, 2));
  } finally {
    await connection.close();
  }
} else {
  console.error("Usage: node packages/db/dist/cli.js migrate|seed");
  process.exitCode = 1;
}
