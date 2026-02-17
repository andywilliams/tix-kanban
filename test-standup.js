#!/usr/bin/env node

// Quick test of the standup generation functionality
import { generateStandupEntry, saveStandupEntry } from './src/server/standup-storage.js';

async function testStandupGeneration() {
  try {
    console.log('🧪 Testing automated standup generation...');
    
    // Generate a standup entry
    const entry = await generateStandupEntry(24);
    
    console.log('\n📋 Generated Standup:');
    console.log(`Date: ${entry.date}`);
    console.log(`\nYesterday (${entry.yesterday.length} items):`);
    entry.yesterday.forEach((item, i) => console.log(`  ${i+1}. ${item}`));
    
    console.log(`\nToday (${entry.today.length} items):`);
    entry.today.forEach((item, i) => console.log(`  ${i+1}. ${item}`));
    
    console.log(`\nBlockers (${entry.blockers.length} items):`);
    entry.blockers.forEach((item, i) => console.log(`  ${i+1}. ${item}`));
    
    console.log(`\n📊 Activity Summary:`);
    console.log(`  - ${entry.commits.length} commits`);
    console.log(`  - ${entry.prs.length} PR activities`);
    console.log(`  - ${entry.issues.length} issues closed`);
    
    // Save it (commented out to avoid duplicate entries)
    // await saveStandupEntry(entry);
    // console.log('\n✅ Standup saved successfully!');
    
    console.log('\n🎉 Standup generation test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testStandupGeneration();