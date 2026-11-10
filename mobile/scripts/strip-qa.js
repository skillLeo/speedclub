/** Removes the QA branch from the inline head script of the production index.html. */
function stripQaBlock(html) {
  return html.replace(/\/\*qa:start\*\/[\s\S]*?\/\*qa:end\*\//g, '');
}

module.exports = { stripQaBlock };
