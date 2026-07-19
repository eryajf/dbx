import { classifySqlStatementRisk, sqlSafetyText, type SqlTextOptions } from "./sql-risk.js";

export interface SqlSafetyOptions {
  allowWrites?: boolean;
  allowDangerous?: boolean;
  allowMultipleStatements?: boolean;
  /** Whether `#` starts a line comment (MySQL family only). Default: false. */
  hashLineComments?: boolean;
}

export interface SqlSafetyDecision {
  allowed: boolean;
  reason?: string;
}

const DANGEROUS_RISKS = new Set(["ddl", "transaction", "unknown"]);

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return undefined;
}

export function evaluateSqlSafety(sql: string, options: SqlSafetyOptions = {}): SqlSafetyDecision {
  const statements = splitSqlStatements(sql, options);
  if (statements.length === 0) return { allowed: false, reason: "SQL is empty." };
  if (statements.length > 1 && !options.allowMultipleStatements) {
    return { allowed: false, reason: "Only one SQL statement is allowed per query." };
  }

  for (let i = 0; i < statements.length; i++) {
    const decision = evaluateSingleSqlStatementSafety(statements[i], options);
    if (!decision.allowed && statements.length > 1) {
      return {
        allowed: false,
        reason: `Statement ${i + 1}: ${decision.reason ?? "SQL blocked."}`,
      };
    }
    if (!decision.allowed) return decision;
  }

  return { allowed: true };
}

function evaluateSingleSqlStatementSafety(sql: string, options: SqlSafetyOptions = {}): SqlSafetyDecision {
  const assessment = classifySqlStatementRisk(sqlSafetyText(sql, options));
  const firstKeyword = assessment.firstKeyword;
  if (!firstKeyword) return { allowed: false, reason: "SQL statement is not recognized." };
  if (firstKeyword === "use") {
    return {
      allowed: false,
      reason: "MCP SQL execution does not allow USE or persistent database switching.",
    };
  }

  if (!options.allowWrites && assessment.risk !== "read") {
    return {
      allowed: false,
      reason: "MCP SQL execution is read-only under the current DBX policy.",
    };
  }

  const guardedMutation = firstKeyword === "update" || firstKeyword === "delete" ? isGuardedUpdateOrDelete(sql, firstKeyword, options) : false;
  const dangerous = DANGEROUS_RISKS.has(assessment.risk) || (assessment.risk === "write" && (firstKeyword === "insert" ? insertHasHighRiskSemantics(sql, options) : !guardedMutation));
  if (dangerous && !options.allowDangerous) {
    return { allowed: false, reason: `High-risk SQL or unrecognized SQL statement "${firstKeyword.toUpperCase()}" is blocked by DBX MCP settings.` };
  }

  return { allowed: true };
}

function insertHasHighRiskSemantics(sql: string, options: SqlSafetyOptions): boolean {
  const normalized = sqlSafetyText(sql, options).toLowerCase().replace(/\s+/g, " ");
  const tokens = tokenizeSqlShape(sql, options);
  return /\binsert\s+(?:or\s+replace|overwrite)\b/.test(normalized) || /\bon\s+duplicate\s+key\s+update\b/.test(normalized) || /\bon\s+conflict\b.*\bdo\s+update\b/.test(normalized) || findTopLevelToken(tokens, "select", 1) >= 0 || insertUsesTableQuerySource(tokens);
}

function insertUsesTableQuerySource(tokens: string[]): boolean {
  const intoIndex = findTopLevelToken(tokens, "into", 1);
  if (intoIndex < 0) return false;

  let cursor = intoIndex + 1;
  if (tokens[cursor] === "only") cursor += 1;
  if (!isPredicateIdentifier(tokens[cursor])) return false;
  cursor += 1;
  while (tokens[cursor] === "." && isPredicateIdentifier(tokens[cursor + 1])) cursor += 2;
  if (tokens[cursor] === "as" && isPredicateIdentifier(tokens[cursor + 1])) cursor += 2;
  if (tokens[cursor] === "(") {
    const close = matchingParenthesisIndex(tokens, cursor);
    if (close < 0) return true;
    cursor = close + 1;
  }
  return tokens[cursor] === "table";
}

const PREDICATE_NON_COLUMN_WORDS = new Set([
  "and",
  "or",
  "not",
  "is",
  "null",
  "true",
  "false",
  "unknown",
  "in",
  "between",
  "distinct",
  "like",
  "ilike",
  "regexp",
  "rlike",
  "exists",
  "select",
  "from",
  "where",
  "case",
  "when",
  "then",
  "else",
  "end",
  "escape",
  "collate",
  "any",
  "all",
  "some",
  "as",
  "__dbx_literal__",
]);
const SQL_STRING_LITERAL_PREFIXES = new Set(["e", "n", "x", "b", "r"]);
const SQL_TYPED_LITERAL_PREFIXES = new Set(["date", "time", "timestamp", "interval"]);
const SQL_VALUE_KEYWORDS = new Set([
  "current_catalog",
  "current_date",
  "current_role",
  "current_schema",
  "current_time",
  "current_timestamp",
  "current_user",
  "localtime",
  "localtimestamp",
  "session_user",
  "system_user",
  "user",
]);
const SQL_DATE_TIME_FIELDS = new Set([
  "century", "day", "decade", "dow", "doy", "epoch", "hour", "isodow", "isoyear", "microseconds",
  "millennium", "milliseconds", "minute", "month", "quarter", "second", "timezone", "timezone_hour",
  "timezone_minute", "week", "year",
]);

function isGuardedUpdateOrDelete(sql: string, keyword: "update" | "delete", options: SqlSafetyOptions): boolean {
  const tokens = tokenizeSqlShape(sql, options);
  if (tokens[0] !== keyword) return false;

  const whereIndex = findTopLevelToken(tokens, "where", 1);
  if (whereIndex < 0) return false;

  if (keyword === "update") {
    const setIndex = findTopLevelToken(tokens, "set", 1);
    if (setIndex < 0 || setIndex >= whereIndex) return false;
    const target = tokens.slice(1, setIndex);
    const assignmentScope = tokens.slice(setIndex + 1, whereIndex);
    if (target.includes("join") || target.includes(",") || findTopLevelToken(assignmentScope, "from", 0) >= 0) {
      return false;
    }
  } else {
    const target = tokens.slice(1, whereIndex);
    if (target.includes("join") || target.includes("using") || target.includes(",")) return false;
  }

  const endIndex = firstTopLevelToken(tokens, ["returning", "order", "limit"], whereIndex + 1);
  return hasEffectivePredicate(tokens.slice(whereIndex + 1, endIndex < 0 ? tokens.length : endIndex));
}

function hasEffectivePredicate(input: string[]): boolean {
  const tokens = stripWrappingParentheses(input);
  if (tokens.length === 0) return false;

  const orParts = flattenTopLevelPredicate(tokens, "or");
  if (orParts.length > 1) {
    // A conjunction inside an OR branch is intentionally treated as opaque.
    // Otherwise an always-true identity can hide one side of a complementary
    // predicate, for example: id = 1 OR (id <> 1 AND TRUE) OR id IS NULL.
    if (orParts.some(hasTopLevelLogicalConjunction)) return false;
    if (
      hasComplementaryNullChecks(orParts)
      || hasComplementaryComparisons(orParts)
      || hasComplementarySetPredicates(orParts)
    ) return false;
    return orParts.every(hasEffectivePredicate);
  }
  const andParts = flattenTopLevelPredicate(tokens, "and");
  if (andParts.length > 1) return andParts.some(hasEffectivePredicate);

  if (isSelfComparison(tokens)) return false;
  if (tokens.includes("select") || tokens.includes("exists")) return false;
  if (isMatchAllLikePredicate(tokens)) return false;

  return hasColumnReference(tokens);
}

function hasColumnReference(tokens: string[]): boolean {
  const functionNameIndexes = new Set<number>();
  for (let openIndex = 0; openIndex < tokens.length; openIndex += 1) {
    if (tokens[openIndex] !== "(") continue;
    let nameIndex = openIndex - 1;
    if (!isPredicateIdentifier(tokens[nameIndex])) continue;
    functionNameIndexes.add(nameIndex);
    while (nameIndex >= 2 && tokens[nameIndex - 1] === "." && isPredicateIdentifier(tokens[nameIndex - 2])) {
      nameIndex -= 2;
      functionNameIndexes.add(nameIndex);
    }
  }

  return tokens.some((token, index) => {
    if (!isPredicateIdentifier(token) || PREDICATE_NON_COLUMN_WORDS.has(token) || isSqlLiteralToken(token)) return false;
    if (SQL_VALUE_KEYWORDS.has(token)) return false;
    if (functionNameIndexes.has(index) || /^[@$#]/.test(token)) return false;
    if (tokens[index - 1] === ":" || tokens[index - 1] === "as") return false;
    if (
      (SQL_STRING_LITERAL_PREFIXES.has(token) || SQL_TYPED_LITERAL_PREFIXES.has(token) || /^_[a-z0-9]+$/.test(token))
      && isSqlLiteralToken(tokens[index + 1])
    ) return false;
    if (
      SQL_DATE_TIME_FIELDS.has(token)
      && ((tokens[index - 1] === "(" && tokens[index - 2] === "extract")
        || (isSqlLiteralToken(tokens[index - 1]) && tokens[index - 2] === "interval"))
    ) return false;
    return true;
  });
}

function isPredicateIdentifier(token: string | undefined): token is string {
  return token !== undefined && /^[a-z_@$#][a-z0-9_@$#-]*$/i.test(token);
}

function isSqlLiteralToken(token: string | undefined): boolean {
  return token === "__dbx_literal__" || token?.startsWith("dbxlit_") === true;
}

function hasComplementaryNullChecks(parts: string[][]): boolean {
  const seen = new Map<string, number>();
  for (const part of parts) {
    const check = parseNullCheck(part);
    if (!check) continue;
    const mask = seen.get(check.operand) ?? 0;
    const nextMask = mask | (check.negated ? 2 : 1);
    if (nextMask === 3) return true;
    seen.set(check.operand, nextMask);
  }
  return false;
}

function parseNullCheck(input: string[]): { operand: string; negated: boolean } | undefined {
  return parseNullCheckWithNegation(input, false);
}

function parseNullCheckWithNegation(
  input: string[],
  outerNegated: boolean,
): { operand: string; negated: boolean } | undefined {
  const tokens = stripWrappingParentheses(input);
  if (tokens[0] === "not") {
    return parseNullCheckWithNegation(tokens.slice(1), !outerNegated);
  }

  let operandEnd = -1;
  let negated = false;
  if (tokens.length >= 3 && tokens.at(-2) === "is" && tokens.at(-1) === "null") {
    operandEnd = tokens.length - 2;
  } else if (tokens.length >= 4 && tokens.at(-3) === "is" && tokens.at(-2) === "not" && tokens.at(-1) === "null") {
    operandEnd = tokens.length - 3;
    negated = true;
  }
  if (operandEnd <= 0) return undefined;

  const operand = stripWrappingParentheses(tokens.slice(0, operandEnd));
  if (operand.length === 0 || !hasColumnReference(operand)) return undefined;
  return { operand: operand.join("\u0000"), negated: negated !== outerNegated };
}

type PredicateComparisonOperator = "eq" | "ne" | "gt" | "ge" | "lt" | "le";

interface PredicateComparisonCheck {
  operands: string;
  operator: PredicateComparisonOperator;
}

function hasComplementaryComparisons(parts: string[][]): boolean {
  const checks = parts.map((part) => parseComparisonCheck(part)).filter((check) => check !== undefined);
  return checks.some((candidate, index) => checks.slice(index + 1).some((other) => (
    candidate.operands === other.operands && comparisonOperatorsAreComplementary(candidate.operator, other.operator)
  )));
}

function parseComparisonCheck(input: string[], outerNegated = false): PredicateComparisonCheck | undefined {
  const tokens = stripWrappingParentheses(input);
  if (tokens[0] === "not") return parseComparisonCheck(tokens.slice(1), !outerNegated);
  if (!hasColumnReference(tokens)) return undefined;

  let depth = 0;
  let operatorIndex = -1;
  let operator: PredicateComparisonOperator | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "(") depth += 1;
    else if (tokens[index] === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const parsed = predicateComparisonOperator(tokens[index]);
      if (!parsed) continue;
      if (operatorIndex >= 0) return undefined;
      operatorIndex = index;
      operator = parsed;
    }
  }
  if (operatorIndex <= 0 || operatorIndex >= tokens.length - 1 || !operator) return undefined;

  let left = stripWrappingParentheses(tokens.slice(0, operatorIndex)).join("\u0000");
  let right = stripWrappingParentheses(tokens.slice(operatorIndex + 1)).join("\u0000");
  if (!left || !right) return undefined;
  if (outerNegated) operator = complementaryComparisonOperator(operator);
  if (left > right) {
    [left, right] = [right, left];
    operator = reverseComparisonOperator(operator);
  }
  return { operands: `${left}\u0001${right}`, operator };
}

function predicateComparisonOperator(token: string | undefined): PredicateComparisonOperator | undefined {
  switch (token) {
    case "=":
    case "==": return "eq";
    case "!=":
    case "<>": return "ne";
    case ">": return "gt";
    case ">=": return "ge";
    case "<": return "lt";
    case "<=": return "le";
    default: return undefined;
  }
}

function complementaryComparisonOperator(operator: PredicateComparisonOperator): PredicateComparisonOperator {
  switch (operator) {
    case "eq": return "ne";
    case "ne": return "eq";
    case "gt": return "le";
    case "ge": return "lt";
    case "lt": return "ge";
    case "le": return "gt";
  }
}

function reverseComparisonOperator(operator: PredicateComparisonOperator): PredicateComparisonOperator {
  switch (operator) {
    case "eq":
    case "ne": return operator;
    case "gt": return "lt";
    case "ge": return "le";
    case "lt": return "gt";
    case "le": return "ge";
  }
}

function comparisonOperatorsAreComplementary(
  left: PredicateComparisonOperator,
  right: PredicateComparisonOperator,
): boolean {
  return complementaryComparisonOperator(left) === right;
}

interface PredicateSetCheck {
  signature: string;
  negated: boolean;
}

function hasComplementarySetPredicates(parts: string[][]): boolean {
  const seen = new Map<string, number>();
  for (const part of parts) {
    const check = parseSetPredicateCheck(part);
    if (!check) continue;
    const mask = seen.get(check.signature) ?? 0;
    const nextMask = mask | (check.negated ? 2 : 1);
    if (nextMask === 3) return true;
    seen.set(check.signature, nextMask);
  }
  return false;
}

function parseSetPredicateCheck(input: string[], outerNegated = false): PredicateSetCheck | undefined {
  const tokens = stripWrappingParentheses(input);
  if (tokens[0] === "not") return parseSetPredicateCheck(tokens.slice(1), !outerNegated);

  const inIndex = findTopLevelToken(tokens, "in", 0);
  if (inIndex > 0) {
    const operatorNegated = tokens[inIndex - 1] === "not";
    const operandEnd = operatorNegated ? inIndex - 1 : inIndex;
    const operand = stripWrappingParentheses(tokens.slice(0, operandEnd));
    if (!hasColumnReference(operand) || tokens[inIndex + 1] !== "(") return undefined;
    const closeIndex = matchingParenthesisIndex(tokens, inIndex + 1);
    if (closeIndex !== tokens.length - 1 || closeIndex <= inIndex + 2) return undefined;
    const values = tokens.slice(inIndex + 2, closeIndex);
    if (values.includes("select")) return undefined;
    const valueParts = splitTopLevelTokens(values, ",");
    if (valueParts.some((part) => part.length === 0)) return undefined;
    let valueSignatures = valueParts.map((part) => stripWrappingParentheses(part).join("\u0000"));
    if (valueParts.every(isStaticInListItem)) {
      valueSignatures = [...new Set(valueSignatures)].sort();
    }
    return {
      signature: JSON.stringify(["in", operand, valueSignatures]),
      negated: operatorNegated !== outerNegated,
    };
  }

  const betweenIndex = findTopLevelToken(tokens, "between", 0);
  if (betweenIndex <= 0) return undefined;
  const operatorNegated = tokens[betweenIndex - 1] === "not";
  const operandEnd = operatorNegated ? betweenIndex - 1 : betweenIndex;
  const operand = stripWrappingParentheses(tokens.slice(0, operandEnd));
  if (!hasColumnReference(operand)) return undefined;
  const andIndex = findTopLevelToken(tokens, "and", betweenIndex + 1);
  if (andIndex <= betweenIndex + 1 || andIndex >= tokens.length - 1) return undefined;
  const low = stripWrappingParentheses(tokens.slice(betweenIndex + 1, andIndex));
  const high = stripWrappingParentheses(tokens.slice(andIndex + 1));
  if (low.length === 0 || high.length === 0) return undefined;
  return {
    signature: JSON.stringify(["between", operand, low, high]),
    negated: operatorNegated !== outerNegated,
  };
}

function isStaticInListItem(input: string[]): boolean {
  const tokens = stripWrappingParentheses(input);
  if (tokens.length === 1) {
    return /^\d+(?:\.\d+)?$/.test(tokens[0] ?? "")
      || isSqlLiteralToken(tokens[0])
      || ["null", "true", "false"].includes(tokens[0] ?? "");
  }
  return tokens.length === 2
    && ["+", "-"].includes(tokens[0] ?? "")
    && /^\d+(?:\.\d+)?$/.test(tokens[1] ?? "");
}

function isMatchAllLikePredicate(input: string[], outerNegated = false): boolean {
  const tokens = stripWrappingParentheses(input);
  if (tokens[0] === "not") return isMatchAllLikePredicate(tokens.slice(1), !outerNegated);

  const likeIndex = firstTopLevelToken(tokens, ["like", "ilike"], 0);
  if (likeIndex <= 0) return false;
  const operatorNegated = tokens[likeIndex - 1] === "not";
  if (operatorNegated !== outerNegated) return false;
  const operandEnd = operatorNegated ? likeIndex - 1 : likeIndex;
  const operand = stripWrappingParentheses(tokens.slice(0, operandEnd));
  const pattern = stripWrappingParentheses(tokens.slice(likeIndex + 1));
  return hasColumnReference(operand)
    && pattern.length === 1
    && pattern[0] === sqlLiteralShapeToken("'%'");
}

function isSelfComparison(tokens: string[]): boolean {
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "(") depth += 1;
    else if (tokens[index] === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && ["=", "==", ">=", "<=", "<=>"].includes(tokens[index] ?? "")) {
      const left = stripWrappingParentheses(tokens.slice(0, index));
      const right = stripWrappingParentheses(tokens.slice(index + 1));
      return left.length > 0 && left.length === right.length && left.every((token, partIndex) => token === right[partIndex]);
    } else if (
      depth === 0
      && tokens[index] === "is"
      && tokens[index + 1] === "not"
      && tokens[index + 2] === "distinct"
      && tokens[index + 3] === "from"
    ) {
      const left = stripWrappingParentheses(tokens.slice(0, index));
      const right = stripWrappingParentheses(tokens.slice(index + 4));
      return left.length > 0 && left.length === right.length && left.every((token, partIndex) => token === right[partIndex]);
    }
  }
  return false;
}

function tokenizeSqlShape(sql: string, options: SqlSafetyOptions): string[] {
  const shape = sqlShapeText(sql, options);
  return shape.toLowerCase().match(/__dbx_literal__|[a-z_@$#][a-z0-9_@$#-]*|\d+(?:\.\d+)?|<=>|<>|!=|<=|>=|==|[-+*/%=<>()?,.;:]/g) ?? [];
}

function sqlShapeText(sql: string, options: SqlSafetyOptions): string {
  let output = "";
  let index = 0;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";
    if (char === "-" && next === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n" && sql[index] !== "\r") index += 1;
      output += " ";
      continue;
    }
    if (options.hashLineComments === true && char === "#") {
      index += 1;
      while (index < sql.length && sql[index] !== "\n" && sql[index] !== "\r") index += 1;
      output += " ";
      continue;
    }
    if (char === "/" && next === "*") {
      const close = sql.indexOf("*/", index + 2);
      index = close < 0 ? sql.length : close + 2;
      output += " ";
      continue;
    }
    if (char === "'") {
      const end = quotedSqlEnd(sql, index, "'", "'");
      output += ` ${sqlLiteralShapeToken(sql.slice(index, end))} `;
      index = end;
      continue;
    }
    if (char === "$") {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(index))?.[0];
      if (tag) {
        const close = sql.indexOf(tag, index + tag.length);
        const end = close < 0 ? sql.length : close + tag.length;
        output += ` ${sqlLiteralShapeToken(sql.slice(index, end))} `;
        index = end;
        continue;
      }
    }
    if (char === '"' || char === "`" || char === "[") {
      const close = char === "[" ? "]" : char;
      const end = quotedSqlEnd(sql, index, char, close);
      output += ` ${sql.slice(index + 1, Math.max(index + 1, end - 1))} `;
      index = end;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

function sqlLiteralShapeToken(value: string): string {
  if (/^'%+'$/.test(value)) return "dbxlit_like_all";
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `dbxlit_${value.length}_${(hash >>> 0).toString(16)}`;
}

function quotedSqlEnd(sql: string, start: number, open: string, close: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === close) {
      if (sql[index + 1] === close) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    if (open !== "[" && sql[index] === "\\" && index + 1 < sql.length) index += 2;
    else index += 1;
  }
  return sql.length;
}

function findTopLevelToken(tokens: string[], token: string, start: number): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    if (tokens[index] === "(") depth += 1;
    else if (tokens[index] === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && tokens[index] === token) return index;
  }
  return -1;
}

function firstTopLevelToken(tokens: string[], candidates: string[], start: number): number {
  let result = -1;
  for (const candidate of candidates) {
    const index = findTopLevelToken(tokens, candidate, start);
    if (index >= 0 && (result < 0 || index < result)) result = index;
  }
  return result;
}

function matchingParenthesisIndex(tokens: string[], openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index] === "(") depth += 1;
    else if (tokens[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function stripWrappingParentheses(input: string[]): string[] {
  let tokens = input;
  while (tokens[0] === "(" && tokens[tokens.length - 1] === ")") {
    let depth = 0;
    let wrapsAll = true;
    for (let index = 0; index < tokens.length - 1; index++) {
      if (tokens[index] === "(") depth += 1;
      else if (tokens[index] === ")") depth -= 1;
      if (depth === 0) {
        wrapsAll = false;
        break;
      }
    }
    if (!wrapsAll) break;
    tokens = tokens.slice(1, -1);
  }
  return tokens;
}

function splitTopLevelPredicate(tokens: string[], operator: "and" | "or"): string[][] {
  return splitTopLevelTokens(tokens, operator);
}

function hasTopLevelLogicalConjunction(input: string[]): boolean {
  const tokens = stripWrappingParentheses(input);
  let depth = 0;
  let pendingBetween = 0;
  for (const token of tokens) {
    if (token === "(") {
      depth += 1;
    } else if (token === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && token === "between") {
      pendingBetween += 1;
    } else if (depth === 0 && token === "and") {
      if (pendingBetween > 0) pendingBetween -= 1;
      else return true;
    }
  }
  return false;
}

function splitTopLevelTokens(tokens: string[], separator: string): string[][] {
  const parts: string[][] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === "(") depth += 1;
    else if (tokens[index] === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && tokens[index] === separator) {
      parts.push(tokens.slice(start, index));
      start = index + 1;
    }
  }
  if (parts.length === 0) return [tokens];
  parts.push(tokens.slice(start));
  return parts;
}

function flattenTopLevelPredicate(tokens: string[], operator: "and" | "or"): string[][] {
  const stripped = stripWrappingParentheses(tokens);
  const parts = splitTopLevelPredicate(stripped, operator);
  if (parts.length === 1) return [stripped];
  return parts.flatMap((part) => flattenTopLevelPredicate(part, operator));
}

export function sqlSafetyFromEnv(env: NodeJS.ProcessEnv = process.env): SqlSafetyOptions {
  const allowWrites = parseBooleanEnv(env.DBX_MCP_ALLOW_WRITES);
  const allowDangerous = parseBooleanEnv(env.DBX_MCP_ALLOW_DANGEROUS_SQL);
  return {
    allowWrites: allowWrites ?? true,
    allowDangerous: allowDangerous ?? false,
  };
}

export function splitSqlStatements(sql: string, options?: SqlTextOptions): string[] {
  const statements: string[] = [];
  let statementStart = 0;
  let index = 0;
  let state: "none" | "single" | "double" | "backtick" | "bracket" | "lineComment" | "blockComment" | "dollar" = "none";
  let dollarTag = "";
  const hashLineComments = options?.hashLineComments === true;

  const pushStatement = (end: number) => {
    const statement = sql.slice(statementStart, end).trim();
    if (statement) statements.push(statement);
  };

  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";

    if (state === "lineComment") {
      if (char === "\n" || char === "\r") state = "none";
      index += 1;
      continue;
    }
    if (state === "blockComment") {
      if (char === "*" && next === "/") {
        state = "none";
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (state === "dollar") {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        state = "none";
      } else {
        index += 1;
      }
      continue;
    }
    if (state === "single" || state === "double" || state === "backtick") {
      const quote = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (char === quote) {
        if (next === quote) {
          index += 2;
          continue;
        }
        state = "none";
      } else if (char === "\\" && next) {
        // Preserve dialects that accept backslash escapes without letting an escaped quote end the literal.
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (state === "bracket") {
      if (char === "]") {
        if (next === "]") {
          index += 2;
          continue;
        }
        state = "none";
      }
      index += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      state = "lineComment";
      index += 2;
      continue;
    }
    if (hashLineComments && char === "#") {
      state = "lineComment";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "blockComment";
      index += 2;
      continue;
    }
    if (char === "'") state = "single";
    else if (char === '"') state = "double";
    else if (char === "`") state = "backtick";
    else if (char === "[") state = "bracket";
    else if (char === "$") {
      const match = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(index));
      if (match) {
        dollarTag = match[0];
        state = "dollar";
        index += dollarTag.length;
        continue;
      }
    } else if (char === ";") {
      pushStatement(index);
      statementStart = index + 1;
    }
    index += 1;
  }

  pushStatement(sql.length);
  return statements;
}
