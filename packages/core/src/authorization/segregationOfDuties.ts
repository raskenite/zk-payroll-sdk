import { SignerRole } from "./types";
import { RawRoleAssignment, RoleMember } from "./roles";

/**
 * Segregation of duties (SoD) validation for signer role assignments.
 *
 * The payroll authorization model relies on distinct signer roles being
 * held by distinct addresses. Allowing one address to hold compliant-sensitive
 * combinations of roles (for example the same address being both the
 * payroll admin and the compliance reviewer) undermines the controls the
 * authorization flow is meant to enforce. This module checks a role assignment
 * set for those conflicts and returns actionable violations.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** A pair of roles that must not be held by the same address. */
export interface SoDRoleConflict {
  /** The first role in the conflicting pair. */
  roleA: SignerRole;
  /** The second role in the conflicting pair. */
  roleB: SignerRole;
  /** Human-readable explanation of why this pair is conflicting. */
  reason: string;
}

/** A single SoD violation found in a role assignment set. */
export interface SoDViolation {
  /** The address that holds the conflicting roles. */
  address: string;
  /** The conflicting role pair. */
  conflict: SoDRoleConflict;
  /** The roles the address is currently assigned to that participate in the conflict. */
  assignedRoles: SignerRole[];
  /** Actionable guidance for the integrator on how to resolve the violation. */
  remediation: string;
}

/** Result of a SoD validation run. */
export interface SoDValidationResult {
  /** True when no SoD violations were found. */
  valid: boolean;
  /** All violations detected, in deterministic order. */
  violations: SoDViolation[];
  /** Number of distinct addresses that were evaluated. */
  evaluatedAddresses: number;
  /** Summary message suitable for logging or surfacing to users. */
  message: string;
}

/** Options for {@link validateSegregationOfDuties}. */
export interface SodValidationOptions {
  /**
   * Additional conflicting role pairs to enforce beyond the default set.
   * Each pair is unordered: `["a", "b"]` and `["b", "a"]` are equivalent.
   */
  additionalConflicts?: Array<readonly [SignerRole, SignerRole]>;
  /**
   * When true, additional conflicts replace the default conflict set instead
   * of being appended to it. Defaults lo `false`.
   */
  replaceDefaultConflicts?: boolean;
  /**
   * Addresses to ignore during validation (for example a known multi-sig
   * treasury address that is explicitly allowed to hold multiple roles).
   * Comparison is case-insensitive.
   */
  allowedAddresses?: readonly string[];
}

/** Error thrown by the fail-fast assertion helper. */
export class SegregationOfDutiesError extends Error {
  constructor(
    message: string,
    public readonly result: SoDValidationResult
  ) {
    super(message);
    this.name = "SegregationOfDutiesError";
  }
}

// -----------------------------------------------------------------------------
// Default conflict matrix
// -----------------------------------------------------------------------------

/** Role pairs that must always be held by different addresses. */
export const DEFAULT_SOD_CONFLICTS: readonly SoDRoleConflict[] = [
  {
    roleA: "payroll_admin",
    roleB: "compliance_reviewer",
    reason:
      "Payroll administrators initiate payments and compliance reviewers approve them; one address must not hold both roles.",
  },
  {
    roleA: "payroll_admin",
    roleB: "emergency_approver",
    reason:
      "Emergency approvers can bypass normal controls; a payroll administrator must not also hold this escalation role.",
  },
  {
    roleA: "treasury_operator",
    roleB: "compliance_reviewer",
    reason:
      "Treasury operators move funds and compliance reviewers audit those moves; one address must not hold both roles.",
  },
] as const;

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

const SIGNER_ROLES: readonly SignerRole[] = [
  "payroll_admin",
  "treasury_operator",
  "compliance_reviewer",
  "emergency_approver",
];

function isSignerRole(value: unknown): value is SignerRole {
  return typeof value === "string" && (SIGNER_ROLES as readonly string[]).includes(value);
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function pairKey(a: SignerRole, b: SignerRole): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

function buildConflictMap(
  conflicts: readonly SodRoleConflict[]
): Map<string, SodRoleConflict> {
  const map = new Map<string, SoDRoleConflict>();
  for (const conflict of conflicts) {
    if (conflict.roleA === conflict.roleB) {
      // Self-conflicts are meaningless; skip them instead of failing.
      continue;
    }
    const key = pairKey(conflict.roleA, conflict.roleB);
    if (!map.has(key)) {
      map.set(key, conflict);
    }
  }
  return map;
}

function resolveConflicts(options?: SodValidationOptions): SodRoleConflict[] {
  const base: SoDRoleConflict[] = options?.replaceDefaultConflicts
    ? []
    : [...DEFAULT_SOD_CONFLICTS];

  const extra: SodRoleConflict[] = [];
  for (const pair of options?.additionalConflicts ?? []) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new TypeError(
        "additionalConflicts entries must be pairs of signer roles"
      );
    }
    const [a, b] = pair;
    if (!isSignerRole(a) || !isSignerRole(b)) {
      throw new TypeError(
        `Unknown signer role in additionalConflicts: ${String(a)}, ${String(b)}`
      );
    }
    extra.push({
      roleA: a,
      roleB: b,
      reason: `Additional conflict registered by caller: ${a} and ${b} must be held by different addresses.`,
    });
  }

  return [...base, ...extra];
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Validates that no single address holds a conflicting pair of signer roles.
 *
 * Accepts the same `RawRoleAssignment[]` shape that {@link listAdminRoles}
 * normalizes, so the result can be fed into the role settings UI or a payroll
 * submission pre-flight check without adapter code.
 *
 * Unrecognized role strings are ignored (they cannot participate in a conflict),
 * duplicate assignments are deduplicated, and addresses are compared case-
 * insensitively after trimming whitespace. The result is deterministic: violations
 * are ordered by address then by the canonical conflict pair key.
 */
export function validateSegregationOfDuties(
  assignments: readonly RawRoleAssignment[] | null | undefined,
  options?: SodValidationOptions
): SoDValidationResult {
  const conflicts = resolveConflicts();
  const conflictMap = buildConflictMap(conflicts);
  const allowed = new Set((options?.allowedAddresses ?? []).map(normalizeAddress));

  // address (normalized) -> roles + original spelling for reporting.
  const byAddress = new Map<string, { display: string; roles: Set<SignerRole> }>();

  for (const entry of assignments ?? []) {
    if (!entry || typeof entry.address !== "string") continue;
    if (!isSignerRole(entry.role)) continue;
    const display = entry.address.trim();
    if (display.length === 0) continue;
    const key = normalizeAddress(display);
    let record = byAddress.get(key);
    if (!record) {
      record = { display, roles: new Set() };
      byAddress.set(key, record);
    }
    record.roles.add(entry.role);
  }

  const violations: SoDViolation[] = [];

  for (const [key, record] of byAddress) {
    if (allowed.has(key)) continue;
    if (record.roles.size < 2) continue;

    const roles = Array.from(record.roles).sort();
    const matched: SoDRoleConflict[] = [];
    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        const conflict = conflictMap.get(pairKey(roles[i], roles[j]));
        if (conflict) {
          matched.push(conflict);
        }
      }
    }

    for (const conflict of matched) {
      violations.push({
        address: record.display,
        conflict,
        assignedRoles: roles,
        remediation: buildRemediation(record.display, conflict),
      });
    }
  }

  violations.sort((a, b) => {
    const addrCmp = normalizeAddress(a.address).localeCompare(
      normalizeAddress(b.address)
    );
    if (addrCmp !== 0) return addrCmp;
    return pairKey(a.conflict.roleA, a.conflict.roleB).localeCompare(
      pairKey(b.conflict.roleA, b.conflict.roleB)
    );
  });

  const valid = violations.length === 0;
  const message = valid
    ? `Segregation of duties validation passed for ${byAddress.size} address(es).`
    : `Segregation of duties violated: ${violations.length} conflict(s) across ${byAddress.size} address(es).`;

  return {
    valid,
    violations,
    evaluatedAddresses: byAddress.size,
    message,
  };
}

/**
 * Fail-fast variant of {@link validateSegregationOfDuties} that throws a
 * {@link SegregationOfDutiesError} carrying the full validation result when any
 * conflict is detected. Use this before submitting a payroll batch or persisting a
 * role assignment change.
 */
export function assertSegregationOfDuties(
  assignments: readonly RawRoleAssignment[] | null | undefined,
  options?: SodValidationOptions
): SoDValidationResult {
  const result = validateSegregationOfDuties(assignments, options);
  if (!result.valid) {
    throw new SegregationOfDutiesError(result.message, result);
  }
  return result;
}

/**
 * Convenience wrapper that runs SoD validation against the normalized output of
 * {@link listAdminRoles}. This is the recommendended entry point for the role
 * settings UI and payroll pre-flight checks.
 */
export function validateRoleGroupSegregation(
  roles: Partial<Record<SignerRole, readonly RoleMember[]>> | null | undefined,
  options?: SodValidationOptions
): SoDValidationResult {
  const assignments: RawRoleAssignment[] = [];
  if (roles) {
    for (const role of SIGNER_ROLES) {
      const members = roles[role];
      if (!members) continue;
      for (const member of members) {
        if (!member || typeof member.address !== "string") continue;
        assignments.push({
          role,
          address: member.address,
          assignedAt: member.assignedAt,
        });
      }
    }
  }
  return validateSegregationOfDuties(assignments, options);
}

function buildRemediation(address: string, conflict: SoDRoleConflict): string {
  return `Remove ${conflict.roleA} or ${conflict.roleB} from ${address} and assign the removed role to a different address.`;
}
