/**
 * SPEED CLUB design-system rule (03_DESIGN_SYSTEM.md §16): style objects may only use tokens.
 *
 * Inside StyleSheet.create(...), createStyles(...) and JSX style={...} this reports:
 *   - numeric literals for spacing, sizing, radius, border and type properties
 *   - fontFamily string literals, and fontWeight anywhere (the family name selects the weight)
 *
 * Allowed: 0, and non-literal expressions such as t.space[16], size.input, StyleSheet.hairlineWidth.
 * Layout ratios (flex, flexGrow, flexShrink, aspectRatio, opacity, zIndex via token) are not
 * covered here because they are not part of the spacing scale.
 */
const RESTRICTED = new Set([
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'marginStart', 'marginEnd', 'marginBlock', 'marginInline',
  'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'paddingHorizontal', 'paddingVertical',
  'paddingStart', 'paddingEnd', 'paddingBlock', 'paddingInline',
  'gap', 'rowGap', 'columnGap',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'top', 'bottom', 'left', 'right', 'start', 'end', 'inset',
  'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'borderWidth', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
  'fontSize', 'lineHeight', 'letterSpacing',
  'shadowRadius', 'elevation',
]);

function propertyName(node) {
  if (node.computed) return null;
  if (node.key.type === 'Identifier') return node.key.name;
  if (node.key.type === 'Literal') return String(node.key.value);
  return null;
}

function isNumericLiteral(node) {
  if (node.type === 'Literal' && typeof node.value === 'number') return true;
  return node.type === 'UnaryExpression' && node.operator === '-' && isNumericLiteral(node.argument);
}

function numericValue(node) {
  return node.type === 'UnaryExpression' ? -node.argument.value : node.value;
}

function isStyleFactory(callee) {
  if (callee.type === 'Identifier') return callee.name === 'createStyles';
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'StyleSheet' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'create'
  );
}

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Only design tokens may provide spacing, sizing, radius and type values in styles.' },
    schema: [],
    messages: {
      rawNumber: 'Raw value {{value}} for "{{prop}}". Use a token from src/theme (space, size, radius, layout).',
      rawFont: 'fontFamily must come from a Text variant or token, never a string literal.',
      fontWeight: 'Do not set fontWeight: the font family name selects the weight (03_DESIGN_SYSTEM.md §4).',
    },
  },
  create(context) {
    let depth = 0;

    function inspect(node) {
      if (depth === 0) return;
      const prop = propertyName(node);
      if (!prop) return;
      if (prop === 'fontWeight') {
        context.report({ node, messageId: 'fontWeight' });
        return;
      }
      if (prop === 'fontFamily' && node.value.type === 'Literal') {
        context.report({ node, messageId: 'rawFont' });
        return;
      }
      if (RESTRICTED.has(prop) && isNumericLiteral(node.value) && numericValue(node.value) !== 0) {
        context.report({ node, messageId: 'rawNumber', data: { prop, value: String(numericValue(node.value)) } });
      }
    }

    return {
      CallExpression(node) {
        if (isStyleFactory(node.callee)) depth += 1;
      },
      'CallExpression:exit'(node) {
        if (isStyleFactory(node.callee)) depth -= 1;
      },
      JSXAttribute(node) {
        if (node.name.name === 'style' || node.name.name === 'contentContainerStyle') depth += 1;
      },
      'JSXAttribute:exit'(node) {
        if (node.name.name === 'style' || node.name.name === 'contentContainerStyle') depth -= 1;
      },
      Property: inspect,
    };
  },
};
