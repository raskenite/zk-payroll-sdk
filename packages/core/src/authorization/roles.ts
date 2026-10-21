import { SignerRole } from "./types";

/**
 * Typed SDK wrapper around admin role list reads (#368), so the role
 * settings UI consumes one predictable response shape instead of raw
 * contract data.
 */

/** Every role group the SDK recognizes, in a stable display order. */
export const SIGNER_ROLE_GROUPS: readonly SignerRole[] = [
  "payroll_admin",
  "treasury_operator",
  "compliance_reviewer",
  "emergency_approver",
];

export interface RoleMember {
  address: string;
  assignedAt?: number;
}

/** Role members grouped by role, normalized so every supported role group is always present (as an empty array if unassigned). */
export type RoleGroupMap = Record<SignerRole, RoleMember[]>;

export interface RoleListResponse {
  roles: RoleGroupMap;
  /** Total members across all role groups, for convenience. */
  totalMembers: number;
}

export class RoleListError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "RoleListError";
  }
}

/** Thrown when a single signer address is assigned to multiple roles, violating the segregation-of-duties policy. */
export class SegregationOfDutiesError extends Error {
  constructor(
    public readonly address: string,
    public readonly roles: SignerRole[],
    public readonly cause?: unknown
  ) {
    super(
      `Signer ${address} is assigned to multiple roles (${roles.join(
        ", "
      )}), violating segregation of duties`
    );
    this.name = "SegregationOfDutiesError";
  }
}

export interface SegregationOfDutiesReimbursement {
  /** Roles assigned to each address, keyed by address. */
  assignments: Record<string, SignerRole[]>;
}

export interface SegregationOfDutiesResult {
  /** True when every address holds at most one role. */
  valid: boolean;
  /** Addresses that violate the policy, along with the roles they hold. */
  violations: Array<{ address: string; roles: SignerRole[] }>;
}

function emptyRoleGroupMap(): RoleGroupMap {
  const map = {} as RoleGroupMap;
  for (const role of SIGNER_ROLE_GROUPS) {
    map[role] = [];
  }
  return map;
}

/** Raw shape a contract/backend role read might return, before normalization. */
export interface RawRoleAssignment {
  role: string;
  address: string;
  assignedAt?: number;
}

/**
 * Fetches admin role lists via `fetchRaw` (typically a contract read or API
 * call supplied by the caller) and normalizes the result: unrecognized role
 * strings are dropped, every supported role group is present even when
 * empty, and any thrown error is wrapped in a `RoleListError` with the
 * original error preserved as `cause`.
 */
export async function listAdminRoles(
  fetchRaw: () => Promise<RawRoleAssignment[]>,
  options: { enforceSegregationOfDuties?: boolean } = {}
): Promise<RoleListResponse> {
  let raw: RawRoleAssignment[];
  try {
    raw = await fetchRaw();
  } catch (err) {
    throw new RoleListError("Failed to fetch admin role list", err);
  }

  const roles = emptyRoleGroupMap();
  let totalMembers = 0;

  for (const entry of raw ?? []) {
    if (!isSignerRole(entry.role)) continue;
    roles[entry.role].push({
      address: entry.address,
      assignedAt: entry.assignedAt,
    });
    totalMembers += 1;
  }

  if (options.enforceSegregationOfDuties) {
    assertSegregationOfDuties(roles);
  }

  return { roles, totalMembers };
}

/**
 * Validates that no single address holds more than one signer role,
 * enforcing the segregation-of-duties policy. Throws a `SegregationOfDutiesError`
 * describing the first offending address and its roles.
 */
export function assertSegregationOfDuties(roles: RoleGroupMap): void {
  const result = checkSegregationOfDuties(roles);
  if (!result.valid) {
    const [first] = result.violations;
    throw new SegregationOfDutiesError(first.address, first.roles);
  }
}

/**
 * Checks the segregation-of-duties policy without throwing, returning all
 * violations so callers can render actionable feedback. Addresses are
 * compared case-insensitively and trimmed, since signer addresses may be
 * reported in different cases across sources.
 */
export function checkSegregationOfDuties(
  roles: RoleGroupMap
): SegregationOfDutiesResult {
  const byAddress = new Map<string, { address: string; roles: SignerRole[] }>();

  for (const role of SIGNER_ROLE_GROUPS) {
    for (const member of roles[role] ?? []) {
      const key = normalizeAddress(member.address);
      if (!key) continue;
      const existing = byAddress.get(key);
      if (existing) {
        if (!existing.roles.includes(role)) {
          existing.roles.push(role);
        }
      } else {
        byAddress.set(key, { address: member.address, roles: [role] });
      }
    }
  }

  const violations = Array.from(byAddress.values()).filter(
    (entry) => entry.roles.length > 1
  );

  return { valid: violations.length === 0, violations };
}

function normalizeAddress(address: string): string {
  return typeof address === "string" ? address.trim().toLowerCase() : "";
}

function isSignerRole(value: string): value is SignerRole {
  return (SIGNER_ROLE_GROUPS as readonly string[]).includes(value);
}
