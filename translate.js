const fs = require('fs');
const path = require('path');
const axios = require('axios');
const glob = require('glob');

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Übersetzungsprompt für technische Dokumentation
const TRANSLATION_PROMPT = `Du bist ein professioneller Übersetzer für technische Blockchain-Dokumentation.
Übersetze den folgenden Text ins Deutsche:

Regeln:
1. Behalte alle Markdown-Formatierungen bei (##, **, \`\`\`, etc.)
2. Übersetze Code-Kommentare, aber NICHT Code-Blöcke
3. Behalte technische Begriffe wie "quorum", "computor", "epoch" bei oder übersetze sie konsistent
4. Behalte URLs und Dateipfade unverändert
5. Behalte YAML-Frontmatter-Struktur bei
6. Verwende professionelle, klare Sprache
7. Achte auf korrekte deutsche Grammatik und Zeichensetzung

Text zum Übersetzen:
`;

async function translateText(text) {
  try {
    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'Du bist ein Experte für technische Übersetzungen im Blockchain-Bereich.'
          },
          {
            role: 'user',
            content: TRANSLATION_PROMPT + text
          }
        ],
        temperature: 0.3,
        max_tokens: 4000
      },
      {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Translation error:', error.response?.data || error.message);
    throw error;
  }
}

// Eigene Frontmatter-Parsing Funktion
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  
  const frontmatterText = match[1];
  const body = match[2].trim();
  const frontmatter = {};
  
  frontmatterText.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();
      // Entferne Anführungszeichen
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Parse numbers
      if (!isNaN(value) && value !== '') {
        frontmatter[key] = parseInt(value);
      } else {
        frontmatter[key] = value;
      }
    }
  });
  
  return { frontmatter, body };
}

// Funktion um Frontmatter als sauberes YAML zu formatieren
function formatFrontmatter(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      // Immer einfache Anführungszeichen verwenden
      lines.push(`${key}: '${value}'`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join('\n');
}

async function translateFile(inputPath, outputPath) {
  console.log(`Translating: ${inputPath}`);
  
  const content = fs.readFileSync(inputPath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(content);

  // Übersetze den Hauptinhalt
  const translatedBody = await translateText(body);

  // Frontmatter übersetzen
  const translatedFrontmatter = { ...frontmatter };
  if (frontmatter.title) {
    translatedFrontmatter.title = await translateText(frontmatter.title);
  }
  if (frontmatter.sidebar_label) {
    translatedFrontmatter.sidebar_label = await translateText(frontmatter.sidebar_label);
  }
  if (frontmatter.description) {
    translatedFrontmatter.description = await translateText(frontmatter.description);
  }

  // Zusammenbauen mit korrektem YAML-Format
  const yamlFrontmatter = formatFrontmatter(translatedFrontmatter);
  const output = `---\n${yamlFrontmatter}\n---\n\n${translatedBody}`;

  // Sicherstellen, dass das Ausgabeverzeichnis existiert
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  
  console.log(`✓ Saved: ${outputPath}`);
}

async function main() {
  const isInitialSync = process.env.IS_INITIAL_SYNC === 'true';
  const changedFilesPath = process.env.CHANGED_FILES;

  let filesToProcess = [];

  if (isInitialSync) {
    // NUR overview Ordner für ersten Test
    filesToProcess = glob.sync('docs/overview/**/*.md');
    console.log(`Initial sync (overview only): Found ${filesToProcess.length} files`);
  } else if (changedFilesPath && fs.existsSync(changedFilesPath)) {
    // Nur geänderte Dateien
    const changedFiles = fs.readFileSync(changedFilesPath, 'utf-8')
      .split('\n')
      .filter(f => f.endsWith('.md'));
    filesToProcess = changedFiles;
    console.log(`Processing ${filesToProcess.length} changed files`);
  }

  // Übersetze jede Datei
  for (const file of filesToProcess) {
    const outputPath = file.replace('docs/', 'i18n/de/docusaurus-plugin-content-docs/current/');
    
    try {
      await translateFile(file, outputPath);
    } catch (error) {
      console.error(`Failed to translate ${file}:`, error);
      process.exit(1);
    }
  }

  // Erstelle Summary
  const summary = {
    timestamp: new Date().toISOString(),
    filesProcessed: filesToProcess.length,
    files: filesToProcess
  };
  fs.writeFileSync('translation-summary.json', JSON.stringify(summary, null, 2));
  
  console.log('\n✓ Translation complete!');
}

main().catch(console.error);
