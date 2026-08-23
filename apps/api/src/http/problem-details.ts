export class ApplicationProblemError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly problemTitle: string,
    detail?: string,
  ) {
    super(detail ?? problemTitle);
    this.name = "ApplicationProblemError";
  }
}

export function problemDetailsBody(input: {
  status: number;
  code: string;
  title: string;
  detail?: string | undefined;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    type: `https://live-photo-studio.example/errors/${input.code}`,
    title: input.title,
    status: input.status,
    code: input.code,
  };
  const detail = input.detail;
  if (detail !== undefined && detail.length > 0) {
    body["detail"] = detail;
  }
  return body;
}
