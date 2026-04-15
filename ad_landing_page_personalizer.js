let uploadedImageB64 = null;
let uploadedMime = 'image/jpeg';

function switchTab(tab) {
  ['upload','url','desc'].forEach(t => {
    document.getElementById('tab'+t.charAt(0).toUpperCase()+t.slice(1)).classList.toggle('active', t===tab);
    document.getElementById('panel'+t.charAt(0).toUpperCase()+t.slice(1)).style.display = t===tab ? 'block' : 'none';
  });
}

function handleFile(input) {
  const file = input.files[0];
  if (!file) return;
  uploadedMime = file.type || 'image/jpeg';
  const reader = new FileReader();
  reader.onload = e => {
    const full = e.target.result;
    uploadedImageB64 = full.split(',')[1];
    const box = document.getElementById('uploadBox');
    box.textContent = file.name;
    box.classList.add('has-file');
    const preview = document.getElementById('imagePreview');
    preview.src = full;
    preview.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function loadModels() {
  const apiKey = document.getElementById('geminiKey').value.trim();
  if (!apiKey) return;
  
  const statusEl = document.getElementById('modelLoadingStatus');
  const selectEl = document.getElementById('geminiModel');
  statusEl.textContent = '(loading...)';
  
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    
    // Filter to models that support generateContent
    const validModels = data.models.filter(m => 
      m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')
    );
    
    if (validModels.length > 0) {
      selectEl.innerHTML = '';
      validModels.forEach(m => {
        const id = m.name.replace('models/', '');
        const option = document.createElement('option');
        option.value = id;
        option.textContent = m.displayName || id;
        // Prioritize gemini-1.5-flash as default if available
        if (id === 'gemini-1.5-flash') option.selected = true;
        selectEl.appendChild(option);
      });
      statusEl.textContent = '(loaded)';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    } else {
      statusEl.textContent = '(no models found)';
    }
  } catch (e) {
    statusEl.textContent = '(error loading)';
    console.error('Failed to load models:', e);
  }
}

async function fetchLandingPage(url) {
  const jinaUrl = 'https://r.jina.ai/' + url;
  const resp = await fetch(jinaUrl, { headers: { 'Accept': 'text/plain' } });
  if (!resp.ok) throw new Error('Could not fetch landing page via Jina');
  const text = await resp.text();
  return text.slice(0, 8000);
}

async function callGemini(apiKey, modelId, prompt, imageB64, imageMime) {
  const parts = [];
  if (imageB64) {
    parts.push({ inlineData: { mimeType: imageMime, data: imageB64 } });
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2000 }
  };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates[0].content.parts[0].text;
}

function setStatus(msg) { document.getElementById('status').textContent = msg; }
function setError(msg) { document.getElementById('errorMsg').textContent = msg; }

async function runPersonalization() {
  setError('');
  const apiKey = document.getElementById('geminiKey').value.trim();
  const selectedModel = document.getElementById('geminiModel').value;
  const landingUrl = document.getElementById('landingUrl').value.trim();
  if (!apiKey) { setError('Please enter your Gemini API key'); return; }
  if (!landingUrl) { setError('Please enter a landing page URL'); return; }

  const activeTab = document.querySelector('.tab.active').id.replace('tab','').toLowerCase();
  let imageB64 = null, imageMime = 'image/jpeg';
  let adContext = '';

  if (activeTab === 'upload') {
    if (!uploadedImageB64) { setError('Please upload an ad image'); return; }
    imageB64 = uploadedImageB64;
    imageMime = uploadedMime;
  } else if (activeTab === 'url') {
    const imgUrl = document.getElementById('adImageUrl').value.trim();
    if (!imgUrl) { setError('Please enter an image URL'); return; }
    try {
      setStatus('Fetching ad image...');
      const r = await fetch(imgUrl);
      const blob = await r.blob();
      imageMime = blob.type || 'image/jpeg';
      const buf = await blob.arrayBuffer();
      imageB64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    } catch(e) { setError('Could not fetch that image URL — try uploading instead'); return; }
  } else {
    adContext = document.getElementById('adDesc').value.trim();
    if (!adContext) { setError('Please describe your ad'); return; }
  }

  const btn = document.getElementById('runBtn');
  btn.disabled = true;
  document.getElementById('results').style.display = 'none';

  try {
    setStatus('Reading landing page...');
    const pageContent = await fetchLandingPage(landingUrl);

    setStatus('Analyzing ad creative...');
    const adPrompt = imageB64
      ? `Analyze this ad image and extract in JSON (no markdown, raw JSON only):
{
  "headline_theme": "...",
  "value_proposition": "...",
  "target_audience": "...",
  "cta_text": "...",
  "emotional_tone": "...",
  "product_category": "...",
  "urgency_level": "low|medium|high",
  "key_benefit": "..."
}`
      : `Based on this ad description: "${adContext}"
Extract in JSON (no markdown, raw JSON only):
{
  "headline_theme": "...",
  "value_proposition": "...",
  "target_audience": "...",
  "cta_text": "...",
  "emotional_tone": "...",
  "product_category": "...",
  "urgency_level": "low|medium|high",
  "key_benefit": "..."
}`;

    const adAnalysisRaw = await callGemini(apiKey, selectedModel, adPrompt, imageB64, imageMime);
    let adAnalysis;
    try {
      adAnalysis = JSON.parse(adAnalysisRaw.replace(/```json|```/g,'').trim());
    } catch(e) {
      adAnalysis = { headline_theme: 'Unknown', value_proposition: 'Unknown', target_audience: 'General', cta_text: 'Get started', emotional_tone: 'Neutral', product_category: 'Product', urgency_level: 'medium', key_benefit: 'Value' };
    }

    setStatus('Generating personalized copy...');
    const personalizationPrompt = `You are a CRO (Conversion Rate Optimization) specialist.

AD BRIEF:
${JSON.stringify(adAnalysis, null, 2)}

LANDING PAGE CONTENT (first 6000 chars):
${pageContent}

Generate personalized copy for this landing page that matches the ad. Respond ONLY with raw JSON, no markdown:
{
  "ad_summary": "2-3 sentence summary of what the ad is about and its target audience",
  "message_match_score": <number 60-98>,
  "sections": [
    {
      "section": "Hero headline",
      "tag": "hero",
      "original": "<extract the actual current headline from the page content>",
      "personalized": "<new headline matching ad theme>",
      "reason": "<one sentence CRO reason for this change>"
    },
    {
      "section": "Hero subtext",
      "tag": "subtext",
      "original": "<extract actual subtext>",
      "personalized": "<new subtext>",
      "reason": "<reason>"
    },
    {
      "section": "Primary CTA",
      "tag": "cta",
      "original": "<extract actual CTA>",
      "personalized": "<new CTA matching ad urgency>",
      "reason": "<reason>"
    },
    {
      "section": "Value proposition",
      "tag": "headline",
      "original": "<extract actual value prop section>",
      "personalized": "<personalized value prop>",
      "reason": "<reason>"
    },
    {
      "section": "Trust signal / social proof",
      "tag": "trust",
      "original": "<extract actual trust signal>",
      "personalized": "<enhanced trust signal aligned with ad audience>",
      "reason": "<reason>"
    }
  ]
}`;

    const resultRaw = await callGemini(apiKey, selectedModel, personalizationPrompt, null, null);
    let result;
    try {
      result = JSON.parse(resultRaw.replace(/```json|```/g,'').trim());
    } catch(e) {
      throw new Error('Gemini returned unexpected output. Try again.');
    }

    renderResults(result, adAnalysis);
    setStatus('');
  } catch(e) {
    setError(e.message);
    setStatus('');
  }
  btn.disabled = false;
}

function tagClass(tag) {
  const map = { hero:'tag-hero', cta:'tag-cta', subtext:'tag-subtext', trust:'tag-trust', headline:'tag-headline' };
  return map[tag] || 'tag-hero';
}

function renderResults(result, adAnalysis) {
  const el = document.getElementById('results');

  let html = `<div class="ad-summary">
    <strong>Ad brief:</strong> ${result.ad_summary || ''}
    <br><span style="color:var(--color-text-secondary);font-size:12px;margin-top:4px;display:block">Audience: ${adAnalysis.target_audience} &nbsp;·&nbsp; Tone: ${adAnalysis.emotional_tone} &nbsp;·&nbsp; Urgency: ${adAnalysis.urgency_level}</span>
  </div>`;

  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:12px;font-size:12px;font-weight:500;color:var(--color-text-secondary);padding:0 4px">
    <span>Original</span><span>Personalized</span>
  </div>`;

  for (const s of (result.sections || [])) {
    html += `<div class="section-card">
      <div class="section-header">
        <div class="section-header-left">
          <span class="section-tag ${tagClass(s.tag)}">${s.section}</span>
        </div>
        <span class="reason-badge">${s.reason || ''}</span>
      </div>
      <div class="diff-row">
        <div class="diff-cell original">
          <div class="diff-label">Original</div>
          ${escHtml(s.original || '—')}
        </div>
        <div class="diff-cell personalized">
          <div class="diff-label">Personalized</div>
          ${escHtml(s.personalized || '—')}
        </div>
      </div>
    </div>`;
  }

  const score = result.message_match_score || 80;
  html += `<div class="score-bar">
    <span class="score-label">Message match score</span>
    <div class="bar-track"><div class="bar-fill" id="barFill" style="width:0%"></div></div>
    <span class="score-num">${score}%</span>
  </div>`;

  el.innerHTML = html;
  el.style.display = 'block';
  setTimeout(() => {
    const bar = document.getElementById('barFill');
    if (bar) bar.style.width = score + '%';
  }, 100);
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
