import { prepareE2eDatabase } from './seed.mjs';

export default async function globalSetup() {
  await prepareE2eDatabase();
}
