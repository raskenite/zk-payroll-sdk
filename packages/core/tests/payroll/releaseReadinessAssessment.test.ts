import {
  assessPayrollReleaseReadiness,
  PayrollReleaseReadinessInput,
  PayrollReleaseReadinessResult,
} from "../../src/payroll/releaseReadinessAssessment";
import { ValidationError } from "../../src/core/errors";

describe("assessPayrollReleaseReadiness", () => {
  // Helper to create a valid baseline input
  const createValidInput = (overrides?: Partial<PayrollReleaseReadinessInput>): PayrollReleaseReadinessInput => ({
    payrollId: "pr_test_001",
    approvalStatus: "approved",
    requiredFunding: 1000000n,
    availableFunding: 2000000n,
    recipientCount: 50,
    lockedRecipientCount: 0,
    stateConsistent: true,
    periodOpen: true,
    ...overrides,
  });

  describe("successful path", () => {
    it("should return ready=true when all checks pass", () => {
      const input = createValidInput();
      const result = assessPayrollReleaseReadiness(input);

      expect(result.ready).toBe(true);
      expect(result.status).toBe("ready");
      expect(result.canProceed).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.checks).toHaveLength(5);
      expect(result.checks.every((c) => c.status === "passed")).toBe(true);
    });

    it("should include all checks in deterministic order", () => {
      const input = createValidInput();
      const result = assessPayrollReleaseReadiness(input);

      const checkIds = result.checks.map((c) => c.id);
      expect(checkIds).toEqual(["approval", "funding", "recipients", "consistency", "period"]);
    });

    it("should have canProceed=true when ready", () => {
      const input = createValidInput();
      const result = assessPayrollReleaseReadiness(input);

      expect(result.canProceed).toBe(true);
    });
  });

  describe("failure path", () => {
    it("should block when approval is rejected", () => {
      const input = createValidInput({ approvalStatus: "rejected" });
      const result = assessPayrollReleaseReadiness(input);

      expect(result.ready).toBe(false);
      expect(result.status).toBe("blocked");
      expect(result.canProceed).toBe(false);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].code).toBe("PAYROLL_REJECTED");
    });

    it("should block when approval is pending", () => {
      const input = createValidInput({ approvalStatus: "pending" });
      const result = assessPayrollReleaseReadiness(input);

      expect(result.ready).toBe(false);
      expect(result.blockers[0].code).toBe("PAYROLL_NOT_APPROVED");
    });

    it("should block when funding is insufficient", () => {
      const input = createValidInput({
        requiredFunding: 5000000n,
        availableFunding: 2000000n,
      });
      const result = assessPayrollReleaseReadiness(input);

      expect(result.ready).toBe(false);
      expect(result.blockers[0].code).toBe("INSUFFICIENT_FUNDING");
    });

    it("should block when recipients are locked", () => {
      const input = createValidInput({
        recipientCount: 50,
        lockedRecipientCount: 5,
      });
      const result = assessPayrollReleaseReadiness(input);

      expect(result.ready).toBe(false);
      expect(result.blockers[0].code).toBe("RECIPIENTS_LOCKED");
      expect(result.blockers[0].message).toContain("5 of 50");
    });

    it("should block when state is inconsistent", () => {
      const input = createValidInput({ stateConsistent: false });
      const result = assessPayrollReleaseReadiness(input);

      expect(result.ready).toBe(false);
      expect(result.blockers[0].code).toBe("STATE_INCONSISTENCY");
    });

    it("should block when period is closed", () => {
      const input = createValidInput({ periodOpen: false });
      const result = assessPayrollReleaseReadiness(input);

      expect(result.ready).toBe(false);
      expect(result.blockers[0].code).toBe("PERIOD_CLOSED");
    });

    it("should accumulate multiple blockers", () => {
      const input = createValidInput({
        approvalStatus: "pending",
        requiredFunding: 5000000n,
        availableFunding: 2000000n,
        lockedRecipientCount: 10,
        periodOpen: false,
      });
      const result = assessPayrollReleaseReadiness(input);

      expect(result.ready).toBe(false);
      expect(result.blockers.length).toBeGreaterThan(1);
      expect(result.message).toContain("blocked");
    });
  });

  describe("edge cases", () => {
    it("should handle zero recipients", () => {
      const input = createValidInput({
        recipientCount: 0,
        lockedRecipientCount: 0,
      });
      const result = assessPayrollReleaseReadiness(input);

      expect(result.ready).toBe(true);
      const recipientCheck = result.checks.find((c) => c.id === "recipients");
      expect(recipientCheck?.status).toBe("passed");
    });

    it("should handle exact funding match (no surplus)", () => {
      const input = createValidInput({
        requiredFunding: 1000000n,
        availableFunding: 1000000n,
      });
      const result = assessPayrollReleaseReadiness(input);

      expect(result.ready).toBe(true);
      const fundingCheck = result.checks.find((c) => c.id === "funding");
      expect(fundingCheck?.status).toBe("passed");
    });

    it("should handle all recipients locked", () => {
      const input = createValidInput({
        recipientCount: 50,
        lockedRecipientCount: 50,
      });
      const result = assessPayrollReleaseReadiness(input);

      expect(result.ready).toBe(false);
      expect(result.blockers[0].code).toBe("RECIPIENTS_LOCKED");
      expect(result.blockers[0].message).toContain("100%");
    });

    it("should calculate locked percentage correctly", () => {
      const input = createValidInput({
        recipientCount: 100,
        lockedRecipientCount: 33,
      });
      const result = assessPayrollReleaseReadiness(input);

      expect(result.blockers[0].message).toContain("33%");
    });

    it("should validate payrollId is non-empty", () => {
      expect(() => {
        assessPayrollReleaseReadiness(createValidInput({ payrollId: "" }));
      }).toThrow(ValidationError);
    });

    it("should validate approval status is one of allowed values", () => {
      expect(() => {
        assessPayrollReleaseReadiness(
          createValidInput({
            approvalStatus: "invalid" as any,
          })
        );
      }).toThrow(ValidationError);
    });

    it("should validate requiredFunding is non-negative bigint", () => {
      expect(() => {
        assessPayrollReleaseReadiness(
          createValidInput({
            requiredFunding: -100n,
          })
        );
      }).toThrow(ValidationError);
    });

    it("should validate lockedRecipientCount does not exceed recipientCount", () => {
      expect(() => {
        assessPayrollReleaseReadiness(
          createValidInput({
            recipientCount: 10,
            lockedRecipientCount: 20,
          })
        );
      }).toThrow(ValidationError);
    });

    it("should throw ValidationError with appropriate code for invalid input", () => {
      try {
        assessPayrollReleaseReadiness(
          createValidInput({
            payrollId: "",
          })
        );
        fail("Expected ValidationError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).code).toBe("INVALID_PAYROLL_ID");
      }
    });
  });

  describe("message formatting", () => {
    it("should include payroll ID in message", () => {
      const input = createValidInput({ payrollId: "pr_unique_123" });
      const result = assessPayrollReleaseReadiness(input);

      expect(result.message).toContain("pr_unique_123");
    });

    it("should list blocker codes when not ready", () => {
      const input = createValidInput({
        approvalStatus: "pending",
        periodOpen: false,
      });
      const result = assessPayrollReleaseReadiness(input);

      expect(result.message).toContain("PAYROLL_NOT_APPROVED");
      expect(result.message).toContain("PERIOD_CLOSED");
    });
  });
});
