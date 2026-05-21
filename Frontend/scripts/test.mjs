import postgres from 'postgres';
const sql = postgres('postgres://postgres:postgres@localhost:5433/graphicdesigner');
async function run() {
  const rows = await sql`select id, name, deleted_at from projects order by updated_at desc`;
  console.log(rows);
  process.exit(0);
}
run();
