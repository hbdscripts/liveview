'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'server', 'public', 'settings.html');
let html = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// Find the Google Ads accordion item in integrations (starts with accordion-item that has settings-integrations-accordion-googleads)
const startMarker = 'data-bs-target="#settings-integrations-accordion-googleads"';
const endMarker = '<div id="settings-panel-attribution"';

const targetIdx = html.indexOf(startMarker);
if (targetIdx === -1) {
  console.error('Start marker not found');
  process.exit(1);
}
const startBlock = html.lastIndexOf('<div class="accordion-item">', targetIdx);
if (startBlock === -1) {
  console.error('Accordion item start not found');
  process.exit(1);
}
const endIdx = html.indexOf(endMarker, targetIdx);
if (endIdx === -1) {
  console.error('End marker not found');
  process.exit(1);
}

// Extract the block and adapt for Admin
let block = html.slice(startBlock, endIdx);
// Change IDs and parent for Admin
block = block
  .replace(/settings-integrations-accordion-googleads/g, 'settings-admin-accordion-googleads')
  .replace(/settings-integrations-panel-googleads/g, 'admin-panel-googleads')
  .replace(/data-bs-parent="#settings-integrations-accordion"/, 'data-bs-parent="#settings-admin-accordion"');

// Remove from integrations
html = html.slice(0, startBlock) + html.slice(endIdx);

// Insert into Admin accordion (before closing divs that precede KEXO_ADMIN_PANEL_END)
const insertMarker = '            </div>\n          </div>\n        </div>\n      </div>\n      <!-- KEXO_ADMIN_PANEL_END -->';
const insertIdx = html.indexOf(insertMarker);
if (insertIdx === -1) {
  console.error('Insert marker not found');
  process.exit(1);
}
html = html.slice(0, insertIdx) + block + '\n              ' + html.slice(insertIdx);

fs.writeFileSync(file, html);
console.log('Moved Google Ads panel to Admin section.');
