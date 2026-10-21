import {
  DEFAULT_SOD_CONFLICTS,
  SegregationOfDutiesError,
  assertSegregationOfDuties,
  validateRoleGroupSegregation,
  validateSegregationOfDuties,
} from "../../src/authorization/segregationOfDuties";
import type { RawRoleAssignment } from "../../src/authorization/roles";

describe("segregation of duties validation", () => {
  const adminAddress = "GADMIN11111111111111111111111111111111111111111";
  const complianceAddress =
    "GCOMPLIANCE2222222222222222222222222222222222222";
  const treasuryAddress =
    "GTREASURY33333333333333333333333333333333333333";

  it("passes when every role is held by a distinct address", () => {
    const assignments: RawRoleAssignment[] = [
      { role: "payroll_admin", address: adminAddress },
      { role: "compliance_reviewer", address: complianceAddress },
      { role: "treasury_operator", address: treasuryAddress },
    ];

    const result = validateSegregationOfDuties(assignments);

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.evaluatedAddresses).toBe(3);
    expect(result.message).toMatch(/passed/i);
  });

  it("reports a violation when one address holds conflicting roles", () => {
    const assignments: RawRoleAssignment[] = [
      { role: "payroll_admin", address: adminAddress },
      { role: "compliance_reviewer", address: adminAddress },
    ];

    const result = validateSegregationOfDuties(assignments);

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    const [violation] = result.violations;
    expect(violation.address).toBe(adminAddress);
    expect(violation.assignedRoles.sort()).toEqual([
      "compliance_reviewer",
      "payroll_admin",
    ]);
    expect(violation.conflict.roleA).toBe("payroll_admin");
    expect(violation.conflict.roleB).toBe("compliance_reviewer");
    expect(violation.remediation).toContain("payroll_admin");
    expect(violation.remediation).toContain("compliance_reviewer");
    expect(result.message).toMatch(/violated/i);
  });

  it("deduplicates repeated assignments and ignores unknown roles", () => {
    const assignments = [
      { role: "payroll_admin", address: adminAddress },
      { role: "payroll_admin", address: adminAddress.toLowerCase() },
      { role: "legacy_role", address: adminAddress },
    ] as RawRoleAssignment[];

    const result = validateSegregationOfDuties(assignments);

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.evaluatedAddresses).toBe(1);
  });

  it("respects allowedAddresses for explicitly exempt addresses", () => {
    const assignments: RawRoleAssignment[] = [
      { role: "payroll_admin", address: adminAddress },
      { role: "compliance_reviewer", address: adminAddress },
    ];

    const result = validateSegregationOfDuties(assignments, {
      allowedAddresses: [adminAddress.toLowerCase()],
    });

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("supports additional conflicts and replacing defaults", () => {
    const assignments: RawRoleAssignment[] = [
      { role: "treasury_operator", address: treasuryAddress },
      { role: "emergency_approver", address: treasuryAddress },
    ];

    // Default configuration does not flag this pair.
    expect(validateSegregationOfDuties(assignments).valid).toBe(
      true
    );

    // Adding the pair as an extra conflict flags it.
    const withExtra = validateSegregationOfDuties(assignments, {
      additionalConflicts: [["treasury_operator", "emergency_approver"]],
    });
    expect(withExtra.valid).toBe(false);
    expect(withExtra.violations).toHaveLength(1);

    // Replacing defaults with only the extra conflict keeps it flagged.
    const replaced = validateSegregationOfDuties(assignments, {
      replaceDefaultConflicts: true,
      additionalConflicts: [["treasury_operator", "emergency_approver"]],
    });
    expect(replaced.valid).toBe(false);
  });

  it("rejects unknown roles in additionalConflicts", () => {
    expect(() =>
      validateSegregationOfDuties([], {
        additionalConflicts: [["not_a_role", "payroll_admin"]] as any,
      })
    ).toThrow(TypeError);
  });

  it("assertSegregationOfDuties throws SegregationOfDutiesError with the result", () => {
    const assignments: RawRoleAssignment[] = [
      { role: "payroll_admin", address: adminAddress },
      { role: "emergency_approver", address: adminAddress },
    ];

    try {
      assertSegregationOfDuties(assignments);
      throw new Error("expected assertSegregationOfDuties to throw");
    } catch (err) {
      expect(err).instanceof(SegregationOfDutiesError);
      const sodError = err as SegregationOfDutiesError;
      expect(sodError.result.valid).toBe(false);
      expect(sodError.result.violations).toHaveLength(1);
    }
  });

  it("validateRoleGroupSegregation accepts normalized role maps", () => {
    const result = validateRoleGroupSegregation({
      payroll_admin: [{ address: adminAddress }],
      compliance_reviewer: [{ address: complianceAddress }],
      treasury_operator: [],
      emergency_approver: [],
    });

    expect(result.valid).toBe(true);
    expect(result.evaluatedAddresses).toBe(2);
  });

  it("exposes the default conflict matrix", () => {
    expect(DEFAULT_SOD_CONFLICTS.length).toBeGreaterThan(0);
    for (const conflict of DEFAULT_SOD_CONFLICTS) {
      expect(conflict.roleA).not.toBe(conflict.roleB);
      expect(conflict.reason.length).toBeGreaterThan(0);
    }
  });
});
