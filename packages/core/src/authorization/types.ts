export type SignerRole =
  "payroll_admin" | "treasury_operator" | "compliance_reviewer" | "emergency_approver";

export type SignerState = "pending" | "signed" | "rejected" | "expired" | "revoked";

export type PolicyType = "unanimous" | "threshold" | "weighted";

export interface AuthorizationPolicy {
  type: PolicyType;
  requiredRoles: SignerRole[];
  threshold?: number;
  weights?: Record<SignerRole, number>;
  expiryMs?: number;
  /**
   * Segregation of duties configuration. Roles listed here cannot be
   * held by the same signer address within a single request.
   */
  segregationOfDuties?: SegregationOfDutiesPolicy;
}

export interface SegregationOfDutiesPolicy {
  /**
   * Whether the segregation of duties check is enforced. Defaults to true
   * when the configuration object is present.
   */
  enforced?: boolean;
  /**
   * Explicit pairs of roles that must not be held by the same signer.
   * When omitted, all distinct required roles are treated as incompatible.
   */
  incompatibleRoles?: Array<[signerRole: SignerRole, conflictingRole: SignerRole]>;
  /**
   * Whether to allow the same address to appear multiple times with the
   * same role. Defaults to false.
   */
  allowDuplicateAddresses?: boolean;
}

export interface SignerInfo {
  address: string;
  role: SignerRole;
  state: SignerState;
  signedAt?: number;
  rejectedAt?: number;
  rejectionReason?: string;
  expiredAt?: number;
}

export interface AuthorizationRequest {
  id: string;
  operationId: string;
  policy: AuthorizationPolicy;
  signers: SignerInfo[];
  createdAt: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface SignaturePayload {
  operationId: string;
  policyId: string;
  signerRole: SignerRole;
  timestamp: number;
  nonce: string;
}

export interface AuthorizationStatus {
  requestId: string;
  isApproved: boolean;
  isPending: boolean;
  isExpired: boolean;
  signedCount: number;
  requiredCount: number;
  rejectionCount: number;
  approvalPercentage: number;
  signers: SignerInfo[];
  reason?: string;
}

export interface MultiSignerCoordinatorOptions {
  maxExpiryMs?: number;
  nonceLength?: number;
  defaultPolicyType?: PolicyType;
  /**
   * Grace period in milliseconds after a request's expiry time during which
   * adjustment approvals are still accepted for review but marked as late.
   */
  expiryGraceMs?: number;
  /**
   * Whether to automatically transition pending signers to the expired
   * state once the request expiry has elapsed.
   */
  autoExpire?: boolean;
  /**
   * Default segregation of duties configuration applied to policies that
   * do not declare their own configuration.
   */
  segregationOfDuties?: SegregationOfDutiesPolicy;
}

export interface PayrollAdjustmentExpiryResult {
  requestId: string;
  expired: boolean;
  expiredAt?: number;
  expiredSigners: SignerInfo[];
  remainingSigners: SignerInfo[];
  reason?: string;
}

export interface SegregationOfDutiesViolation {
  address: string;
  roles: SignerRole[];
  message: string;
}

export interface SegregationOfDutiesValidationResult {
  valid: boolean;
  violations: SegregationOfDutiesViolation[];
}
