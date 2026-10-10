import { resolveEntity } from "../lib/qloo";

// Live call to the Qloo API. Run with:
//   npm run test:qloo
// which loads QLOO_API_KEY from .env.local.

async function main() {
  const query = "Ethiopian single origin coffee";
  const type = "urn:entity:brand";

  console.log(`resolveEntity(${JSON.stringify(query)}, ${JSON.stringify(type)})`);
  const response = await resolveEntity(query, type);

  console.log("--- RAW RESPONSE ---");
  console.log(JSON.stringify(response, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
