#!/usr/bin/env node
/**
 * AI-powered Playwright failure analyzer.
 * Sends failure summary to Gemini API and returns a suggested fix.
 * Set GEMINI_API_KEY to enable. Requires test-results.json from Playwright.
 */
import fs from 'fs'
import path from 'path'

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) {
  console.log('GEMINI_API_KEY not set — skipping AI analysis')
  process.exit(0)
}

const resultsPath = process.argv[2] || path.join(process.cwd(), 'test-results.json')
if (!fs.existsSync(resultsPath)) {
  console.log('No test-results.json found')
  process.exit(0)
}

const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'))

// Playwright JSON reporter: config.suites[].suites[].specs[].tests[].results[].error
function collectFailures(obj, acc = []) {
  if (!obj) return acc
  if (Array.isArray(obj.suites)) obj.suites.forEach(s => collectFailures(s, acc))
  if (Array.isArray(obj.specs)) {
    obj.specs.forEach(s => {
      const tests = (s.tests || []).filter(t => t.status === 'failed' || t.ok === false)
      tests.forEach(t => {
        const err = (t.results || []).map(r => r.error?.message || r.error).filter(Boolean).join('; ')
        acc.push({ title: `${s.title || ''} › ${t.title || 'test'}`, error: err })
      })
    })
  }
  return acc
}

const root = results.config || results
const failed = collectFailures(root)
if (failed.length === 0) {
  console.log('No failures in results')
  process.exit(0)
}

const failureSummary = failed.map(f => `- ${f.title}\n  ${f.error || 'No error message'}`).join('\n\n')

const prompt = `You are a Playwright E2E test expert. The following test(s) failed:

${failureSummary}

Analyze the failure and provide:
1. **Root cause** — Is this a broken test (flaky locator, wrong selector) or a broken feature (logic bug)?
2. **Exact code fix** — Provide the minimal code change required, as a concrete diff or snippet. Use data-testid selectors when possible.
3. **Trace Viewer tip** — One sentence on what to check in the trace (DOM, network, timing).

Keep the response under 500 words. Use markdown.`

try {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.2 }
      })
    }
  )
  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (text) {
    console.log(text)
    fs.writeFileSync(path.join(process.cwd(), 'ai-fix-suggestion.md'), text)
  } else {
    console.log('No response from Gemini:', JSON.stringify(data).slice(0, 200))
  }
} catch (e) {
  console.error('Gemini API error:', e.message)
  process.exit(1)
}
