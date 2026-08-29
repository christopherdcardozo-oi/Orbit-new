const fs = require('fs');
const path = '/Users/cdcardozo/.gemini/antigravity/scratch/antigravity-mobile/app/(app)/profile.tsx';
let content = fs.readFileSync(path, 'utf8');

// Fix the return structure
content = content.replace(
  /<>\n\s*<CosmicBackground \/>\n\s*<ScrollView style=\{styles\.container\}/g,
  '<View style={styles.container}>\n      <CosmicBackground />\n      <ScrollView style={{ flex: 1 }}'
);
content = content.replace(/<\/ScrollView>\n\s*<\/>/g, '</ScrollView>\n    </View>');

fs.writeFileSync(path, content);
