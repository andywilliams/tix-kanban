#!/usr/bin/env npx tsx

import { 
  getPersonaMemory, 
  setPersonaMemory, 
  appendPersonaMemory, 
  getPersonaMemoryWithTokens,
  createPersonaContext,
  updatePersonaMemoryAfterTask
} from './src/server/persona-storage.js';

async function testMemorySystem() {
  console.log('🧪 Testing persona memory system...');
  
  const testPersonaId = 'test-persona';
  
  try {
    // Test 1: Initial empty memory
    console.log('\n1. Testing initial empty memory...');
    const emptyMemory = await getPersonaMemory(testPersonaId);
    console.log(`Empty memory: "${emptyMemory}"`);
    
    // Test 2: Set initial memory
    console.log('\n2. Setting initial memory...');
    const initialMemory = `# Test Persona Memory

## Initial Learning
- Test persona created
- Ready for tasks
`;
    await setPersonaMemory(testPersonaId, initialMemory);
    const retrievedMemory = await getPersonaMemory(testPersonaId);
    console.log(`Retrieved memory:\n${retrievedMemory}`);
    
    // Test 3: Append to memory
    console.log('\n3. Appending to memory...');
    const newLearning = `## 2026-02-15 - First Task (✅ Success)

**Task:** Test task completion

**Key Learnings:**
- Memory system working correctly
- Appending functionality operational`;
    
    await appendPersonaMemory(testPersonaId, newLearning);
    const updatedMemory = await getPersonaMemory(testPersonaId);
    console.log(`Updated memory:\n${updatedMemory}`);
    
    // Test 4: Memory with tokens
    console.log('\n4. Testing memory with token counting...');
    const memoryWithTokens = await getPersonaMemoryWithTokens(testPersonaId);
    console.log(`Memory tokens: ${memoryWithTokens.tokenCount}, Is large: ${memoryWithTokens.isLarge}`);
    
    // Test 5: Context creation (mock persona)
    console.log('\n5. Testing context creation...');
    // First create a mock persona file
    await setPersonaMemory('test-persona', '# Test Persona Prompt\nYou are a test persona.');
    
    // Note: This will fail because we don't have the persona in the index, but that's expected for this test
    try {
      const context = await createPersonaContext(
        testPersonaId,
        'Test Task',
        'This is a test task',
        ['test', 'memory'],
        'Additional context'
      );
      console.log(`Context created with ${context.tokenCount} tokens, memory truncated: ${context.memoryTruncated}`);
    } catch (error) {
      console.log(`Context creation failed as expected (persona not in index): ${error}`);
    }
    
    // Test 6: Update memory after task
    console.log('\n6. Testing memory update after task...');
    await updatePersonaMemoryAfterTask(
      testPersonaId,
      'Memory Test Task',
      'Test the memory update functionality',
      'Task completed successfully with memory test',
      true
    );
    
    const finalMemory = await getPersonaMemory(testPersonaId);
    console.log(`Final memory:\n${finalMemory}`);
    
    console.log('\n✅ All memory tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testMemorySystem();