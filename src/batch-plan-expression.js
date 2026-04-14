const freezeDeep = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }

  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
};

const normalizeRequiredExpression = (value, label) => {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new TypeError(`${label} must not be empty`);
  }

  return normalizedValue;
};

const createToken = (type, position, extra = {}) =>
  freezeDeep({
    type,
    position,
    ...extra,
  });

const isWhitespace = (character) => /\s/u.test(character);

const isStructuralCharacter = (character) =>
  character === "(" ||
  character === ")" ||
  character === "!" ||
  character === "&" ||
  character === "|" ||
  isWhitespace(character);

const readComparisonToken = (expression, startIndex) => {
  let separatorIndex = startIndex;

  while (separatorIndex < expression.length) {
    const character = expression[separatorIndex];

    if (character === ":") {
      break;
    }

    if (isStructuralCharacter(character)) {
      throw new SyntaxError(
        `Invalid batch-plan comparison starting at position ${startIndex}: expected ":" before "${character}"`,
      );
    }

    separatorIndex += 1;
  }

  if (separatorIndex >= expression.length || expression[separatorIndex] !== ":") {
    throw new SyntaxError(
      `Invalid batch-plan comparison starting at position ${startIndex}: missing ":" separator`,
    );
  }

  const field = expression.slice(startIndex, separatorIndex).trim();

  if (!field) {
    throw new SyntaxError(
      `Invalid batch-plan comparison starting at position ${startIndex}: field must not be empty`,
    );
  }

  let endIndex = separatorIndex + 1;

  while (endIndex < expression.length) {
    const character = expression[endIndex];

    if (isWhitespace(character) || character === "(" || character === ")") {
      break;
    }

    if (character === "!" || expression.startsWith("&&", endIndex) || expression.startsWith("||", endIndex)) {
      break;
    }

    endIndex += 1;
  }

  const value = expression.slice(separatorIndex + 1, endIndex).trim();

  if (!value) {
    throw new SyntaxError(
      `Invalid batch-plan comparison starting at position ${startIndex}: value must not be empty`,
    );
  }

  return {
    token: createToken("comparison", startIndex, {
      field,
      value,
    }),
    nextIndex: endIndex,
  };
};

export const tokenizeBatchPlanExpression = (expression) => {
  const normalizedExpression = normalizeRequiredExpression(
    expression,
    "batchPlanExpression",
  );
  const tokens = [];
  let index = 0;

  while (index < normalizedExpression.length) {
    const character = normalizedExpression[index];

    if (isWhitespace(character)) {
      index += 1;
      continue;
    }

    if (normalizedExpression.startsWith("&&", index)) {
      tokens.push(createToken("and", index));
      index += 2;
      continue;
    }

    if (normalizedExpression.startsWith("||", index)) {
      tokens.push(createToken("or", index));
      index += 2;
      continue;
    }

    if (character === "!") {
      tokens.push(createToken("not", index));
      index += 1;
      continue;
    }

    if (character === "(") {
      tokens.push(createToken("open-paren", index));
      index += 1;
      continue;
    }

    if (character === ")") {
      tokens.push(createToken("close-paren", index));
      index += 1;
      continue;
    }

    const { token, nextIndex } = readComparisonToken(normalizedExpression, index);
    tokens.push(token);
    index = nextIndex;
  }

  return freezeDeep(tokens);
};

const createComparisonNode = (token) =>
  freezeDeep({
    type: "comparison",
    field: token.field,
    value: token.value,
  });

const createUnaryNode = (operand) =>
  freezeDeep({
    type: "not",
    operand,
  });

const createBinaryNode = (type, left, right) =>
  freezeDeep({
    type,
    left,
    right,
  });

const BATCH_PLAN_EXPRESSION_PRECEDENCE = freezeDeep({
  or: 1,
  and: 2,
  not: 3,
  comparison: 4,
});

const BATCH_PLAN_EXPRESSION_SORT_ORDER = freezeDeep({
  comparison: 0,
  not: 1,
  and: 2,
  or: 3,
});

const formatTokenForError = (token) => {
  if (!token) {
    return "end of expression";
  }

  if (token.type === "comparison") {
    return `${token.field}:${token.value}`;
  }

  switch (token.type) {
    case "and":
      return "&&";
    case "or":
      return "||";
    case "not":
      return "!";
    case "open-paren":
      return "(";
    case "close-paren":
      return ")";
    default:
      return token.type;
  }
};

const createTokenReader = (tokens) => {
  let index = 0;

  return {
    peek() {
      return tokens[index] ?? null;
    },
    consume(expectedType) {
      const token = tokens[index] ?? null;

      if (!token || token.type !== expectedType) {
        const found = formatTokenForError(token);
        throw new SyntaxError(
          `Unexpected token ${found} while parsing batch-plan expression; expected ${expectedType}`,
        );
      }

      index += 1;
      return token;
    },
    maybeConsume(expectedType) {
      const token = tokens[index] ?? null;

      if (!token || token.type !== expectedType) {
        return null;
      }

      index += 1;
      return token;
    },
    hasRemainingTokens() {
      return index < tokens.length;
    },
  };
};

export const parseBatchPlanExpression = (expression) => {
  const tokens = tokenizeBatchPlanExpression(expression);
  const reader = createTokenReader(tokens);

  const parsePrimary = () => {
    const token = reader.peek();

    if (!token) {
      throw new SyntaxError(
        "Unexpected end of batch-plan expression while parsing a primary clause",
      );
    }

    if (token.type === "comparison") {
      return createComparisonNode(reader.consume("comparison"));
    }

    if (token.type === "open-paren") {
      reader.consume("open-paren");
      const nestedExpression = parseOrExpression();

      if (!reader.maybeConsume("close-paren")) {
        throw new SyntaxError(
          'Batch-plan expression contains an unclosed "(" group',
        );
      }

      return nestedExpression;
    }

    throw new SyntaxError(
      `Unexpected token ${formatTokenForError(token)} while parsing batch-plan expression`,
    );
  };

  const parseUnaryExpression = () => {
    if (reader.maybeConsume("not")) {
      return createUnaryNode(parseUnaryExpression());
    }

    return parsePrimary();
  };

  const parseAndExpression = () => {
    let leftOperand = parseUnaryExpression();

    while (reader.maybeConsume("and")) {
      leftOperand = createBinaryNode(
        "and",
        leftOperand,
        parseUnaryExpression(),
      );
    }

    return leftOperand;
  };

  const parseOrExpression = () => {
    let leftOperand = parseAndExpression();

    while (reader.maybeConsume("or")) {
      leftOperand = createBinaryNode(
        "or",
        leftOperand,
        parseAndExpression(),
      );
    }

    return leftOperand;
  };

  const ast = parseOrExpression();

  if (reader.hasRemainingTokens()) {
    throw new SyntaxError(
      `Unexpected trailing token ${formatTokenForError(reader.peek())} in batch-plan expression`,
    );
  }

  return ast;
};

const flattenBinaryOperands = (node, type, operands = []) => {
  if (node.type === type) {
    flattenBinaryOperands(node.left, type, operands);
    flattenBinaryOperands(node.right, type, operands);
    return operands;
  }

  operands.push(node);
  return operands;
};

const compareCanonicalNodes = (left, right) => {
  const leftTypeOrder = BATCH_PLAN_EXPRESSION_SORT_ORDER[left.type];
  const rightTypeOrder = BATCH_PLAN_EXPRESSION_SORT_ORDER[right.type];

  if (leftTypeOrder !== rightTypeOrder) {
    return leftTypeOrder - rightTypeOrder;
  }

  return serializeCanonicalBatchPlanExpressionNode(left).localeCompare(
    serializeCanonicalBatchPlanExpressionNode(right),
  );
};

const canonicalizeBatchPlanExpressionNode = (node) => {
  switch (node.type) {
    case "comparison":
      return node;
    case "not":
      return createUnaryNode(canonicalizeBatchPlanExpressionNode(node.operand));
    case "and":
    case "or": {
      const canonicalOperands = flattenBinaryOperands(node, node.type)
        .map(canonicalizeBatchPlanExpressionNode)
        .sort(compareCanonicalNodes);

      return canonicalOperands
        .slice(1)
        .reduce(
          (leftOperand, rightOperand) =>
            createBinaryNode(node.type, leftOperand, rightOperand),
          canonicalOperands[0],
        );
    }
    default:
      throw new TypeError(`Unsupported batch-plan expression node type: ${node.type}`);
  }
};

const wrapCanonicalNode = (serializedNode, node, parentType) =>
  BATCH_PLAN_EXPRESSION_PRECEDENCE[node.type] <
  BATCH_PLAN_EXPRESSION_PRECEDENCE[parentType]
    ? `(${serializedNode})`
    : serializedNode;

const serializeCanonicalBatchPlanExpressionNode = (node) => {
  switch (node.type) {
    case "comparison":
      return `${node.field}:${node.value}`;
    case "not": {
      const serializedOperand = serializeCanonicalBatchPlanExpressionNode(
        node.operand,
      );

      return `!${wrapCanonicalNode(serializedOperand, node.operand, "not")}`;
    }
    case "and":
    case "or": {
      const operator = node.type === "and" ? " && " : " || ";
      const operands = flattenBinaryOperands(node, node.type).map((operand) =>
        wrapCanonicalNode(
          serializeCanonicalBatchPlanExpressionNode(operand),
          operand,
          node.type,
        ),
      );

      return operands.join(operator);
    }
    default:
      throw new TypeError(`Unsupported batch-plan expression node type: ${node.type}`);
  }
};

export const normalizeBatchPlanExpression = (expression) =>
  serializeCanonicalBatchPlanExpressionNode(
    canonicalizeBatchPlanExpressionNode(parseBatchPlanExpression(expression)),
  );
