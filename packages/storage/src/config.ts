import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value: unknown) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const objectStorageEnvironmentSchema = z
  .object({
    OBJECT_STORAGE_BACKEND: z.enum(["mock", "s3"]).default("mock"),
    OBJECT_STORAGE_ENDPOINT: z.preprocess(
      (value: unknown) => (value === "" ? undefined : value),
      z.string().url().optional(),
    ),
    OBJECT_STORAGE_REGION: z.string().min(1).default("us-east-1"),
    OBJECT_STORAGE_BUCKET: optionalNonEmptyString,
    OBJECT_STORAGE_ACCESS_KEY_ID: optionalNonEmptyString,
    OBJECT_STORAGE_SECRET_ACCESS_KEY: optionalNonEmptyString,
    OBJECT_STORAGE_FORCE_PATH_STYLE: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(900)
      .default(300),
  })
  .superRefine((value, context) => {
    if (value.OBJECT_STORAGE_BACKEND !== "s3") return;
    const required: Array<
      [
        | "OBJECT_STORAGE_ENDPOINT"
        | "OBJECT_STORAGE_BUCKET"
        | "OBJECT_STORAGE_ACCESS_KEY_ID"
        | "OBJECT_STORAGE_SECRET_ACCESS_KEY",
        string,
      ]
    > = [
      ["OBJECT_STORAGE_ENDPOINT", "a URL endpoint"],
      ["OBJECT_STORAGE_BUCKET", "a bucket name"],
      ["OBJECT_STORAGE_ACCESS_KEY_ID", "an access key"],
      ["OBJECT_STORAGE_SECRET_ACCESS_KEY", "a secret key"],
    ];
    for (const [path, description] of required) {
      if (value[path]) continue;
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path],
        message: `S3 storage requires ${description}.`,
      });
    }
  });

export type ObjectStorageEnvironment = z.infer<
  typeof objectStorageEnvironmentSchema
>;

export interface S3CompatibleObjectStorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}

export function loadObjectStorageEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ObjectStorageEnvironment {
  return objectStorageEnvironmentSchema.parse(environment);
}

export function toS3CompatibleConfig(
  environment: ObjectStorageEnvironment,
): S3CompatibleObjectStorageConfig {
  if (
    environment.OBJECT_STORAGE_BACKEND !== "s3" ||
    !environment.OBJECT_STORAGE_ENDPOINT ||
    !environment.OBJECT_STORAGE_BUCKET ||
    !environment.OBJECT_STORAGE_ACCESS_KEY_ID ||
    !environment.OBJECT_STORAGE_SECRET_ACCESS_KEY
  ) {
    throw new ObjectStorageConfigurationError();
  }
  return {
    endpoint: environment.OBJECT_STORAGE_ENDPOINT,
    region: environment.OBJECT_STORAGE_REGION,
    bucket: environment.OBJECT_STORAGE_BUCKET,
    accessKeyId: environment.OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: environment.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    forcePathStyle: environment.OBJECT_STORAGE_FORCE_PATH_STYLE,
  };
}

export class ObjectStorageConfigurationError extends Error {
  constructor() {
    super(
      "S3 object storage requires OBJECT_STORAGE_ENDPOINT, OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_ACCESS_KEY_ID and OBJECT_STORAGE_SECRET_ACCESS_KEY.",
    );
    this.name = "ObjectStorageConfigurationError";
  }
}
