import type { Context } from "hono";

interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}

export function success<T>(c: Context, data?: T, message = "Success", status = 200) {
  const body: ApiResponse<T> = { success: true, message };
  if (data !== undefined) body.data = data;
  return c.json(body, status as 200);
}

export function error(c: Context, message: string, status = 500) {
  const body: ApiResponse = { success: false, message };
  return c.json(body, status as 500);
}

export default { success, error };
