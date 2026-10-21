import {
  AuditIntegrityMarkerManager,
  AuditExportPayload,
  IntegrityMarkerResult,
} from "../../src/audit/integrity-marker";

describe("Audit Record Immutability Tests", () => {
  const manager = new AuditIntegrityMarkerManager("sha256");

  // Helper to create a valid audit export payload
  const createValidPayload = (overrides?: Partial<AuditExportPayload>): AuditExportPayload => ({
    exportId: "export_001",
    timestamp: new Date().toISOString(),
    payrollBatchId: "batch_001",
    records: [
      {
        id: "record_001",
        action: "payment",
        amount: 1000,
        recipient: "GXXXX...",
        status: "completed",
      },
    ],
    metadata: {
      totalRecords: 1,
      period: "2025-01",
    },
    ...overrides,
  });

  describe("Successful path - Immutability validation", () => {
    it("should generate a consistent marker for the same payload", () => {
      const payload = createValidPayload();
      const marker1 = manager.generateMarker(payload);
      const marker2 = manager.generateMarker(payload);

      expect(marker1.marker).toBe(marker2.marker);
      expect(marker1.algorithm).toBe(marker2.algorithm);
      expect(marker1.exportId).toBe(payload.exportId);
    });

    it("should verify a marker for valid payload", () => {
      const payload = createValidPayload();
      const result = manager.generateMarker(payload);

      const isValid = manager.verifyMarker(payload, result.marker);
      expect(isValid).toBe(true);
    });

    it("should generate different markers with different payloads", () => {
      const payload1 = createValidPayload({ exportId: "export_001" });
      const payload2 = createValidPayload({ exportId: "export_002" });

      const marker1 = manager.generateMarker(payload1);
      const marker2 = manager.generateMarker(payload2);

      expect(marker1.marker).not.toBe(marker2.marker);
    });

    it("should use consistent algorithm in result", () => {
      const payload = createValidPayload();
      const result = manager.generateMarker(payload);

      expect(result.algorithm).toBe("sha256");
    });

    it("should include exportId in result", () => {
      const payload = createValidPayload({ exportId: "export_specific_123" });
      const result = manager.generateMarker(payload);

      expect(result.exportId).toBe("export_specific_123");
    });
  });

  describe("Failure path - Immutability violation detection", () => {
    it("should reject marker if record content was modified", () => {
      const payload = createValidPayload();
      const result = manager.generateMarker(payload);

      // Attempt to modify a record
      const modifiedPayload = {
        ...payload,
        records: [
          {
            ...payload.records[0],
            amount: 2000, // Modified amount
          },
        ],
      };

      const isValid = manager.verifyMarker(modifiedPayload, result.marker);
      expect(isValid).toBe(false);
    });

    it("should reject marker if metadata was modified", () => {
      const payload = createValidPayload();
      const result = manager.generateMarker(payload);

      const modifiedPayload = {
        ...payload,
        metadata: {
          ...payload.metadata,
          totalRecords: 2, // Modified metadata
        },
      };

      const isValid = manager.verifyMarker(modifiedPayload, result.marker);
      expect(isValid).toBe(false);
    });

    it("should reject marker if timestamp was modified", () => {
      const payload = createValidPayload();
      const result = manager.generateMarker(payload);

      const modifiedPayload = {
        ...payload,
        timestamp: new Date(Date.now() + 1000 * 60).toISOString(), // Modified timestamp
      };

      const isValid = manager.verifyMarker(modifiedPayload, result.marker);
      expect(isValid).toBe(false);
    });

    it("should reject marker if batch ID was modified", () => {
      const payload = createValidPayload();
      const result = manager.generateMarker(payload);

      const modifiedPayload = {
        ...payload,
        payrollBatchId: "batch_002", // Modified batch ID
      };

      const isValid = manager.verifyMarker(modifiedPayload, result.marker);
      expect(isValid).toBe(false);
    });

    it("should reject marker if record was added", () => {
      const payload = createValidPayload();
      const result = manager.generateMarker(payload);

      const modifiedPayload = {
        ...payload,
        records: [...payload.records, { id: "record_002", action: "approval", status: "approved" }],
      };

      const isValid = manager.verifyMarker(modifiedPayload, result.marker);
      expect(isValid).toBe(false);
    });

    it("should reject marker if record was removed", () => {
      const payload = createValidPayload({
        records: [
          { id: "record_001", action: "payment", amount: 1000 },
          { id: "record_002", action: "approval", status: "approved" },
        ],
      });
      const result = manager.generateMarker(payload);

      const modifiedPayload = {
        ...payload,
        records: payload.records.slice(1), // Removed first record
      };

      const isValid = manager.verifyMarker(modifiedPayload, result.marker);
      expect(isValid).toBe(false);
    });

    it("should throw error if exportId is missing", () => {
      const invalidPayload = {
        timestamp: new Date().toISOString(),
        payrollBatchId: "batch_001",
        records: [],
      } as unknown;

      expect(() => {
        manager.generateMarker(invalidPayload as AuditExportPayload);
      }).toThrow("Invalid audit export payload");
    });

    it("should throw error if payload is null", () => {
      expect(() => {
        manager.generateMarker(null as unknown as AuditExportPayload);
      }).toThrow("Invalid audit export payload");
    });

    it("should return false when verifying with incorrect marker", () => {
      const payload = createValidPayload();
      manager.generateMarker(payload);

      const isValid = manager.verifyMarker(payload, "invalid_marker_string");
      expect(isValid).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle payload with empty records array", () => {
      const payload = createValidPayload({
        records: [],
      });

      const result = manager.generateMarker(payload);
      expect(result.marker).toBeDefined();
      expect(result.marker.length).toBeGreaterThan(0);
    });

    it("should handle payload with no metadata", () => {
      const payload = createValidPayload({
        metadata: undefined,
      });

      const result = manager.generateMarker(payload);
      expect(result.marker).toBeDefined();

      // Verify consistency
      const result2 = manager.generateMarker(payload);
      expect(result.marker).toBe(result2.marker);
    });

    it("should handle payload with complex nested records", () => {
      const payload = createValidPayload({
        records: [
          {
            id: "record_001",
            action: "payment",
            details: {
              amount: 1000,
              recipient: { account: "GXXXX...", name: "Employee 1" },
              metadata: { period: "2025-01", department: "Engineering" },
            },
          },
        ],
      });

      const result = manager.generateMarker(payload);
      const isValid = manager.verifyMarker(payload, result.marker);
      expect(isValid).toBe(true);
    });

    it("should reject modification of deeply nested record property", () => {
      const payload = createValidPayload({
        records: [
          {
            id: "record_001",
            action: "payment",
            details: {
              amount: 1000,
              recipient: { account: "GXXXX...", name: "Employee 1" },
            },
          },
        ],
      });

      const result = manager.generateMarker(payload);

      const firstRecord = payload.records[0] as Record<string, unknown>;
      const modifiedPayload = {
        ...payload,
        records: [
          {
            ...firstRecord,
            details: {
              ...(firstRecord.details as Record<string, unknown>),
              recipient: {
                ...((firstRecord.details as Record<string, unknown>).recipient as Record<
                  string,
                  unknown
                >),
                name: "Employee 2", // Modified nested name
              },
            },
          },
        ],
      };

      const isValid = manager.verifyMarker(modifiedPayload, result.marker);
      expect(isValid).toBe(false);
    });

    it("should support HMAC verification with secret key", () => {
      const payload = createValidPayload();
      const secretKey = "secret_signing_key";

      const result = manager.generateMarker(payload, secretKey);
      const isValid = manager.verifyMarker(payload, result.marker, secretKey);

      expect(isValid).toBe(true);
    });

    it("should reject HMAC verification with wrong secret key", () => {
      const payload = createValidPayload();
      const secretKey1 = "secret_key_1";
      const secretKey2 = "secret_key_2";

      const result = manager.generateMarker(payload, secretKey1);
      const isValid = manager.verifyMarker(payload, result.marker, secretKey2);

      expect(isValid).toBe(false);
    });

    it("should reject HMAC verification when secret key is omitted", () => {
      const payload = createValidPayload();
      const secretKey = "secret_signing_key";

      const result = manager.generateMarker(payload, secretKey);
      // Try to verify with no secret key (unsigned vs signed)
      const isValid = manager.verifyMarker(payload, result.marker);

      expect(isValid).toBe(false);
    });

    it("should maintain marker consistency across multiple calls", () => {
      const payload = createValidPayload();
      const markers = Array.from({ length: 5 }, () => manager.generateMarker(payload).marker);

      // All markers should be identical
      const firstMarker = markers[0];
      markers.forEach((marker) => {
        expect(marker).toBe(firstMarker);
      });
    });

    it("should have createdAt timestamp in result", () => {
      const payload = createValidPayload();
      const result = manager.generateMarker(payload);

      expect(result.createdAt).toBeDefined();
      expect(new Date(result.createdAt)).toBeInstanceOf(Date);
      expect(new Date(result.createdAt).getTime()).toBeGreaterThan(0);
    });
  });
});
