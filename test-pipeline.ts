import { GoogleGenAI } from '@google/genai';
import Parser from 'rss-parser';

async function test() {
  console.log("Starting test...");
  try {
    const res = await fetch('http://localhost:3000/api/trigger-pipeline', { method: 'POST' });
    const data = await res.json();
    console.log("Response:", data);
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
