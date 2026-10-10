#!/usr/bin/env bash
# CropSignal Phase 1 setup. Run from the directory where "cropsignal/" should be created:
#   bash cropsignal-phase2/setup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Scaffold. Pinned to create-next-app@15: "@latest" now installs Next.js 16.
npx create-next-app@15 cropsignal \
  --typescript --tailwind --eslint --app --no-src-dir \
  --import-alias "@/*" --use-npm --turbopack
cd cropsignal

# 2. Verify Next ^15 / React ^19. Stop if not.
node -e '
const p = require("./package.json");
const next = p.dependencies.next, react = p.dependencies.react;
console.log("next:", next, " react:", react);
if (!/^[\^~]?15\./.test(next) || !/^[\^~]?19\./.test(react)) {
  console.error("STOP: expected next 15.x and react 19.x");
  process.exit(1);
}
'

# 3. TypeScript strict mode.
if grep -q '"strict": true' tsconfig.json; then
  echo "tsconfig: strict already true"
else
  sed -i.bak 's/"strict": false/"strict": true/' tsconfig.json && rm -f tsconfig.json.bak
  grep -q '"strict": true' tsconfig.json || { echo "STOP: could not enable strict mode"; exit 1; }
  echo "tsconfig: strict enabled"
fi

# 4. Dependencies.
npm install @google/genai papaparse zod recharts react-force-graph-2d \
  @radix-ui/react-switch @radix-ui/react-dialog @radix-ui/react-tooltip
npm install -D @types/papaparse tsx

# Mastra is an attempt only: note the result and continue either way.
if npm install @mastra/core; then
  echo "MASTRA: installed"
else
  echo "MASTRA: install FAILED (continuing without it, per plan)"
fi

# 5-8, 10. Overlay: pages, routes, components, lib, scripts, tests, env example, demo CSV.
cp -R "$SCRIPT_DIR/overlay/." .

# Script to run the live test with .env.local loaded.
npm pkg set scripts.test:qloo="tsx --env-file=.env.local scripts/test-qloo.ts"

# 9. .gitignore. The default ".env*" rule also hides .env.example, so re-allow it.
grep -qx '.env.local' .gitignore || printf '\n.env.local\n' >> .gitignore
grep -qx '!.env.example' .gitignore || printf '!.env.example\n' >> .gitignore
grep -qx '!.env.local.example' .gitignore || printf '!.env.local.example\n' >> .gitignore

echo
echo "Setup finished. Dev script:"
grep '"dev"' package.json
echo
echo "Next:"
echo "  cp .env.example .env.local   # then put your keys in QLOO_API_KEY and GEMINI_API_KEY"
echo "  npm run test:qloo            # live call; paste the output back"
echo "  npx tsx scripts/reality-check.ts # Phase 2: full live pipeline; paste the whole output back"
echo "  npm run dev                        # log should say (Turbopack)"
