#!/usr/bin/env node

// Test script to verify slack sync also runs slx digest

async function testSlackSync() {
  console.log('Testing slack sync with digest...');

  try {
    // Test manual sync via API
    console.log('\n1. Testing manual sync via API...');
    const response = await fetch('http://localhost:3001/api/slx/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const result = await response.json();
    console.log('Sync result:', result);

    // Check if digest was created
    console.log('\n2. Checking if digest was created...');
    const dataResponse = await fetch('http://localhost:3001/api/slx/data');
    const data = await dataResponse.json();

    if (data.digest) {
      console.log('✅ Digest found! Length:', data.digest.length);
      console.log('First 200 chars:', data.digest.substring(0, 200) + '...');
    } else {
      console.log('❌ No digest found');
    }

    console.log('\n✅ Test complete!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\nMake sure:');
    console.log('1. tix-kanban server is running on port 3001');
    console.log('2. slx is installed and configured');
    console.log('3. You have slack access configured');
  }
}

// Run the test
testSlackSync();