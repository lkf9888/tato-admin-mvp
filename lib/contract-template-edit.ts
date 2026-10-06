/**
 * Editing a template that people have already signed against.
 *
 * The template is not a snapshot: an envelope reads its fields and its PDF
 * LIVE until the moment it completes, and `ContractFieldValue.fieldId` is a
 * foreign key onto `ContractTemplateField` with `onDelete: Cascade`. Save the
 * field editor and the route used to `deleteMany` every field and recreate
 * them with fresh ids — so the database deleted every signature, initial and
 * typed answer collected against that template, in the same statement.
 *
 * What that looks like: a renter signs, the operator nudges a signature
 * box half a centimetre, presses save, and the renter's signature is gone.
 * The recipient is still SIGNED so they cannot sign again, and the
 * envelope finalises into a document with empty boxes. (HostHub, which
 * shares this code's ancestry, lost signatures this way in production.)
 *
 * The rules below are the smallest set that makes editing safe without making
 * it useless. Move a field, resize it, rename it, hand it to a different
 * signer — all fine, the value follows its field. The two things that are
 * refused are the two that destroy what somebody already gave you:
 *
 *   - deleting a field that holds a value, because the value dies with it;
 *   - changing the TYPE of a field that holds a value, because a signature
 *     stored on a field that is now a checkbox is a signature that no longer
 *     appears in the document.
 */

export type ExistingField = {
  id: string;
  type: string;
  /** How many envelopes have recorded something against this field. */
  valueCount: number;
};

export type IncomingField = {
  id?: unknown;
  type?: unknown;
};

export type FieldEditPlan =
  | {
      ok: true;
      /** Fields to rewrite in place, keeping their id and their values. */
      updateIds: string[];
      /** Fields with no id yet, or an id this template does not own. */
      createIndexes: number[];
      /** Existing fields the payload dropped, none of which hold a value. */
      deleteIds: string[];
    }
  | {
      ok: false;
      reason: "would_delete_signed_fields" | "would_retype_signed_fields";
      /** How many values the refused edit would have destroyed. */
      valueCount: number;
      fieldIds: string[];
    };

export function planFieldEdit(
  existing: ExistingField[],
  incoming: IncomingField[],
): FieldEditPlan {
  const byId = new Map(existing.map((field) => [field.id, field]));
  const updateIds: string[] = [];
  const createIndexes: number[] = [];
  const retyped: ExistingField[] = [];

  incoming.forEach((field, index) => {
    const id = typeof field.id === "string" ? field.id : "";
    const match = id ? byId.get(id) : undefined;
    if (!match) {
      // No id, or an id belonging to another template — either way this is a
      // new field rather than an edit of an existing one.
      createIndexes.push(index);
      return;
    }
    updateIds.push(id);
    const type = typeof field.type === "string" ? field.type : match.type;
    if (type !== match.type && match.valueCount > 0) retyped.push(match);
  });

  if (retyped.length > 0) {
    return {
      ok: false,
      reason: "would_retype_signed_fields",
      valueCount: retyped.reduce((sum, field) => sum + field.valueCount, 0),
      fieldIds: retyped.map((field) => field.id),
    };
  }

  const kept = new Set(updateIds);
  const dropped = existing.filter((field) => !kept.has(field.id));
  const signedDrops = dropped.filter((field) => field.valueCount > 0);
  if (signedDrops.length > 0) {
    return {
      ok: false,
      reason: "would_delete_signed_fields",
      valueCount: signedDrops.reduce((sum, field) => sum + field.valueCount, 0),
      fieldIds: signedDrops.map((field) => field.id),
    };
  }

  return {
    ok: true,
    updateIds,
    createIndexes,
    deleteIds: dropped.map((field) => field.id),
  };
}

/**
 * Envelope states that forbid swapping the template's document out from
 * under them.
 *
 * Regenerating the PDF from edited Word text, or appending another file,
 * replaces `ContractTemplate.pdfPathname` -- and an envelope out for
 * signature renders onto that file when it completes. Editing the wording
 * after someone signed would produce a signed PDF of a document they never
 * saw, carrying their signature. COMPLETED envelopes already hold their own
 * signed copy and its hash; DRAFT ones have not been sent to anybody.
 */
export const DOCUMENT_EDIT_BLOCKING_STATUSES = ["SENT", "PARTIALLY_SIGNED"] as const;
