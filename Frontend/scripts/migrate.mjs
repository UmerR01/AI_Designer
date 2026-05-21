import postgres from 'postgres';
const sql = postgres('postgres://postgres:postgres@localhost:5433/graphicdesigner');
async function run() {
  await sql`alter table projects add column if not exists deleted_at timestamptz default null`;
  console.log('done');
  process.exit(0);
}
run();
