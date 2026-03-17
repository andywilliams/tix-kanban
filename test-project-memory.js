import { addProjectMemoryEntry, getProjectMemory, renderProjectMemory, getProjectMemoryStats } from './dist/server/project-memory.js';

async function test() {
  console.log('🧪 Testing Project Memory\n');
  await addProjectMemoryEntry('architecture', 'Use TypeScript strict mode', 'test', 8);
  await addProjectMemoryEntry('convention', 'Name test files .test.ts', 'test', 6);
  await addProjectMemoryEntry('lesson', 'Timeout 20min after failures', 'test', 7);
  const memory = await getProjectMemory();
  console.log(`✅ ${memory.entries.length} entries\n`);
  console.log(await renderProjectMemory(2000));
  const stats = await getProjectMemoryStats();
  console.log(`\n📊 Total: ${stats.totalEntries}, Avg: ${stats.avgImportance.toFixed(1)}`);
  console.log('✅ Tests passed!');
}
test().catch(console.error);
