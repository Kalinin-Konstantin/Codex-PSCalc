import type { UserProfile } from "../auth/types.ts";
import { buildExternalSellerInsert, buildSellerCheckInsert } from "./mapper.ts";
import type {
  ExternalSellerInsert,
  SellerCheckInsert,
  SellerCheckResult,
  SellerCheckSaveRequest,
  SellerCheckSaveResponse
} from "./types.ts";

type ExternalSellerRow = {
  id: string;
};

type SellerCheckRow = {
  id: string;
  external_seller_ref: string;
  created_at: string;
};

type DatabaseResult<T> =
  | { data: T; error: null }
  | { data: null; error: DatabaseError };

type DatabaseError = {
  code?: string;
  message?: string;
};

export type SellerChecksDatabase = {
  findExternalSeller(input: {
    marketplace: string;
    normalizedSellerKey: string;
  }): Promise<DatabaseResult<ExternalSellerRow | null>>;
  insertExternalSeller(input: ExternalSellerInsert): Promise<DatabaseResult<ExternalSellerRow>>;
  insertSellerCheck(input: SellerCheckInsert): Promise<DatabaseResult<SellerCheckRow>>;
};

export async function saveSellerCheck(input: {
  database: SellerChecksDatabase;
  request: SellerCheckSaveRequest;
  profile: UserProfile;
}): Promise<SellerCheckResult<SellerCheckSaveResponse>> {
  const externalSellerResult = await findOrCreateExternalSeller(input.database, input.request, input.profile);
  if (!externalSellerResult.ok) return externalSellerResult;

  const sellerCheck = buildSellerCheckInsert({
    request: input.request,
    profile: input.profile,
    externalSellerId: externalSellerResult.data.id
  });
  const insertResult = await input.database.insertSellerCheck(sellerCheck);
  if (insertResult.error) return databaseError(insertResult.error);

  return {
    ok: true,
    data: {
      checkId: insertResult.data.id,
      externalSellerId: insertResult.data.external_seller_ref,
      createdAt: insertResult.data.created_at
    }
  };
}

export function createSupabaseSellerChecksDatabase(supabase: {
  from: (table: string) => unknown;
}): SellerChecksDatabase {
  return {
    async findExternalSeller(input) {
      const query = tableQuery(supabase, "external_sellers");
      const { data, error } = await query
        .select("id")
        .eq("marketplace", input.marketplace)
        .eq("normalized_seller_key", input.normalizedSellerKey)
        .maybeSingle();

      return error ? { data: null, error } : { data: data ? { id: String(data.id) } : null, error: null };
    },

    async insertExternalSeller(input) {
      const query = tableQuery(supabase, "external_sellers");
      const { data, error } = await query
        .insert(input)
        .select("id")
        .single();

      return error ? { data: null, error } : { data: { id: String(data.id) }, error: null };
    },

    async insertSellerCheck(input) {
      const query = tableQuery(supabase, "seller_checks");
      const { data, error } = await query
        .insert(input)
        .select("id,external_seller_ref,created_at")
        .single();

      return error
        ? { data: null, error }
        : {
            data: {
              id: String(data.id),
              external_seller_ref: String(data.external_seller_ref),
              created_at: String(data.created_at)
            },
            error: null
          };
    }
  };
}

async function findOrCreateExternalSeller(
  database: SellerChecksDatabase,
  request: SellerCheckSaveRequest,
  profile: UserProfile
): Promise<SellerCheckResult<ExternalSellerRow>> {
  const externalSeller = buildExternalSellerInsert(request, profile);
  const lookup = await database.findExternalSeller({
    marketplace: externalSeller.marketplace,
    normalizedSellerKey: externalSeller.normalized_seller_key
  });
  if (lookup.error) return databaseError(lookup.error);
  if (lookup.data) return { ok: true, data: lookup.data };

  const created = await database.insertExternalSeller(externalSeller);
  if (!created.error) return { ok: true, data: created.data };
  if (!isUniqueViolation(created.error)) return databaseError(created.error);

  const afterConflict = await database.findExternalSeller({
    marketplace: externalSeller.marketplace,
    normalizedSellerKey: externalSeller.normalized_seller_key
  });
  if (afterConflict.error) return databaseError(afterConflict.error);
  if (afterConflict.data) return { ok: true, data: afterConflict.data };

  return {
    ok: false,
    error: {
      code: "external_seller_conflict",
      message: "External seller was created concurrently but could not be loaded."
    }
  };
}

function databaseError(error: DatabaseError): SellerCheckResult<never> {
  if (error.code === "42501") {
    return { ok: false, error: { code: "database_forbidden", message: "Database access denied." } };
  }

  if (["23502", "23503", "23505", "23514", "22P02"].includes(error.code ?? "")) {
    return {
      ok: false,
      error: {
        code: "database_constraint_error",
        message: "Seller check data violates database constraints."
      }
    };
  }

  return {
    ok: false,
    error: {
      code: "database_error",
      message: "Seller check could not be saved."
    }
  };
}

function isUniqueViolation(error: DatabaseError) {
  return error.code === "23505";
}

function tableQuery(supabase: { from: (table: string) => unknown }, table: string) {
  return supabase.from(table) as {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          maybeSingle: () => Promise<{ data: { id: unknown } | null; error: DatabaseError | null }>;
        };
      };
    };
    insert: (input: unknown) => {
      select: (columns: string) => {
        single: () => Promise<{
          data: Record<string, unknown>;
          error: DatabaseError | null;
        }>;
      };
    };
  };
}
