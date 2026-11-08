// Tool registry: picks the tool set for a run and renders OpenAI tool schemas.
const fsTools = require('./fs');
const { shell, shell_output } = require('./shell');
const { web_search, web_fetch } = require('./web');
const { computer } = require('./computer');
const mcp = require('./mcp');

/**
 * opts: { config, model, depth, readOnly, extra: [tool] }
 */
function selectTools({ config, model, depth = 0, readOnly = false, extra = [] }) {
  const t = config.tools || {};
  const list = [fsTools.read_file, fsTools.list_dir, fsTools.glob, fsTools.grep];
  if (!readOnly) list.push(fsTools.write_file, fsTools.edit_file, fsTools.multi_edit);
  if (t.shell !== false && !readOnly) list.push(shell, shell_output);
  if (t.web !== false) list.push(web_search, web_fetch);
  const vision = model && model.vision !== false;
  if (vision) list.push(fsTools.view_image);
  if (t.computer && vision && depth === 0 && !readOnly) list.push(computer);
  if (t.mcp !== false && depth === 0) list.push(...mcp.mcpTools());
  list.push(...extra);
  return list;
}

function schemas(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: typeof t.description === 'function' ? t.description() : t.description,
      parameters: t.parameters,
    },
  }));
}

module.exports = { selectTools, schemas };
