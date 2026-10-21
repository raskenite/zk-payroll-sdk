/**
 * Payroll Release Readiness Assessment
 *
 * Validates payroll state and dependencies before release/execution.
 * Checks that a payroll run meets all prerequisites for safe execution:
 * approval status, funding, recipient locks, and consistency constraints.
 *
 * @module
 */

import { ValidationError } from "../core/errors";

/** Stable identifiers for each readiness check in the assessment. */
export type PayrollReleaseReadinessCheckId =
  | "approval"
  | "funding"
  | "recipients"
  | "consistency"
  | "period";

/** Status of a single readiness check. */
export type PayrollReleaseReadinessCheckStatus = "passed" | "blocked" | "warning";

/** One check's result within an assessment. */
export interface PayrollReleaseReadinessCheck {
  id: PayrollReleaseReadinessCheckId;
  status: PayrollReleaseReadinessCheckStatus;
  code: string;
  message: string;
}

/** Overall readiness assessment result. */
export interface PayrollReleaseReadinessResult {
  /** True only when all checks are passed (no blocked checks). */
  ready: boolean;
  /** Overall status: "ready", "blocked", or "warning". */
  status: "ready" | "blocked" | "warning";
  /** Checks performed, in deterministic order. */
  checks: PayrollReleaseReadinessCheck[];
  /** Checks with status "blocked", ordered by severity. */
  blockers: PayrollReleaseReadinessCheck[];
  /** Privacy-safe, human-readable summary. */
  message: string;
  canProceed: boolean;
}

/** Input to the release readiness assessment. */
export interface PayrollReleaseReadinessInput {
  /** Payroll run identifier or reference. */
  payrollId: string;
  /** Current approval status: approved, pending, or rejected. */
  approvalStatus: "approved" | "pending" | "rejected";
  /** Total required funding, in stroops. */
  requiredFunding: bigint;
  /** Available funding, in stroops. */
  availableFunding: bigint;
  /** Count of recipients in the payroll. */
  recipientCount: number;
  /** Count of recipients with active locks. */
  lockedRecipientCount: number;
  /** Whether internal state consistency checks passed. */
  stateConsistent: boolean;
  /** Whether the payroll period is open/valid. */
  periodOpen: boolean;
}

/** Fixed, deterministic check ordering. */
const CHECK_ORDER: readonly PayrollReleaseReadinessCheckId[] = [
  "approval",
  "funding",
  "recipients",
  "consistency",
  "period",
];

/**
 * Assesses whether a payroll is ready for release/execution.
 *
 * Evaluates approval, funding availability, recipient lock status,
 * state consistency, and period validity. Returns a structured result
 * with check details and blocking reasons.
 *
 * @param input - Payroll state to assess
 * @returns Assessment result with check details and overall readiness
 * @throws {ValidationError} If input is malformed or invalid
 *
 * @example
 * ```ts
 * const assessment = assessPayrollReleaseReadiness({
 *   payrollId: "pr_123",
 *   approvalStatus: "approved",
 *   requiredFunding: 1000000n,
 *   availableFunding: 2000000n,
 *   recipientCount: 50,
 *   lockedRecipientCount: 0,
 *   stateConsistent: true,
 *   periodOpen: true,
 * });
 * assessment.ready; // true
 * ```
 */
export function assessPayrollReleaseReadiness(
  input: PayrollReleaseReadinessInput
): PayrollReleaseReadinessResult {
  validateAssessmentInput(input);

  const checks: PayrollReleaseReadinessCheck[] = [];

  // Check 1: Approval Status
  if (input.approvalStatus === "rejected") {
    checks.push({
      id: "approval",
      status: "blocked",
      code: "PAYROLL_REJECTED",
      message: "Payroll has been rejected and cannot proceed. Review and resubmit.",
    });
  } else if (input.approvalStatus === "pending") {
    checks.push({
      id: "approval",
      status: "blocked",
      code: "PAYROLL_NOT_APPROVED",
      message: "Payroll has not been approved. Obtain necessary approvals before release.",
    });
  } else {
    checks.push({
      id: "approval",
      status: "passed",
      code: "PAYROLL_APPROVED",
      message: "Payroll is approved.",
    });
  }

  // Check 2: Funding
  const fundingShortfall = input.requiredFunding - input.availableFunding;
  if (fundingShortfall > 0n) {
    checks.push({
      id: "funding",
      status: "blocked",
      code: "INSUFFICIENT_FUNDING",
      message: `Insufficient funding: required ${input.requiredFunding}, available ${input.availableFunding}.`,
    });
  } else {
    checks.push({
      id: "funding",
      status: "passed",
      code: "FUNDING_AVAILABLE",
      message: "Sufficient funding is available.",
    });
  }

  // Check 3: Recipients
  if (input.lockedRecipientCount > 0) {
    const lockedPercentage = Math.round(
      (input.lockedRecipientCount / Math.max(input.recipientCount, 1)) * 100
    );
    checks.push({
      id: "recipients",
      status: "blocked",
      code: "RECIPIENTS_LOCKED",
      message: `${input.lockedRecipientCount} of ${input.recipientCount} recipient(s) are locked (${lockedPercentage}%). Release locked recipients before proceeding.`,
    });
  } else {
    checks.push({
      id: "recipients",
      status: "passed",
      code: "RECIPIENTS_AVAILABLE",
      message: `All ${input.recipientCount} recipient(s) are available.`,
    });
  }

  // Check 4: State Consistency
  if (!input.stateConsistent) {
    checks.push({
      id: "consistency",
      status: "blocked",
      code: "STATE_INCONSISTENCY",
      message: "Internal payroll state is inconsistent. Contact support.",
    });
  } else {
    checks.push({
      id: "consistency",
      status: "passed",
      code: "STATE_CONSISTENT",
      message: "Internal state is consistent.",
    });
  }

  // Check 5: Period Status
  if (!input.periodOpen) {
    checks.push({
      id: "period",
      status: "blocked",
      code: "PERIOD_CLOSED",
      message: "Payroll period is closed. Open the period before release.",
    });
  } else {
    checks.push({
      id: "period",
      status: "passed",
      code: "PERIOD_OPEN",
      message: "Payroll period is open.",
    });
  }

  const blockers = checks.filter((check) => check.status === "blocked");
  const hasWarnings = checks.some((check) => check.status === "warning");
  const ready = blockers.length === 0;

  const status: "ready" | "blocked" | "warning" = ready ? (hasWarnings ? "warning" : "ready") : "blocked";

  const message =
    ready && !hasWarnings
      ? `Payroll ${input.payrollId} is ready for release. All checks passed.`
      : ready && hasWarnings
        ? `Payroll ${input.payrollId} is ready with warnings. Review warnings before release.`
        : `Payroll ${input.payrollId} cannot be released. ${blockers.length} check(s) blocked: ${blockers.map((b) => b.code).join(", ")}`;

  return {
    ready,
    status,
    checks,
    blockers,
    message,
    canProceed: ready,
  };
}

/**
 * Validates assessment input for correct types and ranges.
 *
 * @throws {ValidationError} If input is invalid
 */
function validateAssessmentInput(input: PayrollReleaseReadinessInput): void {
  if (typeof input.payrollId !== "string" || input.payrollId.trim() === "") {
    throw new ValidationError(
      "payrollId must be a non-empty string",
      "payrollId",
      "INVALID_PAYROLL_ID"
    );
  }

  const validApprovalStatuses = ["approved", "pending", "rejected"];
  if (!validApprovalStatuses.includes(input.approvalStatus)) {
    throw new ValidationError(
      `approvalStatus must be one of: ${validApprovalStatuses.join(", ")}`,
      "approvalStatus",
      "INVALID_APPROVAL_STATUS"
    );
  }

  if (typeof input.requiredFunding !== "bigint" || input.requiredFunding < 0n) {
    throw new ValidationError(
      "requiredFunding must be a non-negative bigint",
      "requiredFunding",
      "INVALID_REQUIRED_FUNDING"
    );
  }

  if (typeof input.availableFunding !== "bigint" || input.availableFunding < 0n) {
    throw new ValidationError(
      "availableFunding must be a non-negative bigint",
      "availableFunding",
      "INVALID_AVAILABLE_FUNDING"
    );
  }

  if (!Number.isInteger(input.recipientCount) || input.recipientCount < 0) {
    throw new ValidationError(
      "recipientCount must be a non-negative integer",
      "recipientCount",
      "INVALID_RECIPIENT_COUNT"
    );
  }

  if (!Number.isInteger(input.lockedRecipientCount) || input.lockedRecipientCount < 0) {
    throw new ValidationError(
      "lockedRecipientCount must be a non-negative integer",
      "lockedRecipientCount",
      "INVALID_LOCKED_RECIPIENT_COUNT"
    );
  }

  if (input.lockedRecipientCount > input.recipientCount) {
    throw new ValidationError(
      "lockedRecipientCount cannot exceed recipientCount",
      "lockedRecipientCount",
      "LOCKED_EXCEEDS_TOTAL"
    );
  }

  if (typeof input.stateConsistent !== "boolean") {
    throw new ValidationError(
      "stateConsistent must be a boolean",
      "stateConsistent",
      "INVALID_STATE_CONSISTENT"
    );
  }

  if (typeof input.periodOpen !== "boolean") {
    throw new ValidationError(
      "periodOpen must be a boolean",
      "periodOpen",
      "INVALID_PERIOD_OPEN"
    );
  }
}
