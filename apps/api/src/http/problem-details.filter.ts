import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { Catch, HttpException } from "@nestjs/common";
import type { ZodError } from "zod";
import {
  ApplicationProblemError,
  problemDetailsBody,
} from "./problem-details.js";

interface ProblemResponse {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void };
}

function isZodError(error: unknown): error is ZodError {
  return (
    error !== null &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ProblemResponse>();
    const send = (
      status: number,
      code: string,
      title: string,
      detail?: string | undefined,
    ): void => {
      response.setHeader("Content-Type", "application/problem+json");
      response
        .status(status)
        .json(problemDetailsBody({ status, code, title, detail }));
    };

    if (exception instanceof ApplicationProblemError) {
      send(exception.status, exception.code, exception.problemTitle, exception.message);
      return;
    }

    if (isZodError(exception)) {
      const first = exception.issues[0];
      send(
        422,
        "VALIDATION_FAILED",
        "Request validation failed.",
        first ? `${first.path.join(".")}: ${first.message}` : undefined,
      );
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      send(status, `HTTP_${status}`, exception.message);
      return;
    }

    console.error(
      JSON.stringify({
        event: "api.unhandled_error",
        message: exception instanceof Error ? exception.name : "UnknownError",
      }),
    );
    send(500, "INTERNAL_ERROR", "An unexpected error occurred.");
  }
}
