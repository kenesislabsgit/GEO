import { NextResponse } from "next/server";
import { usingLocalDb } from "@/lib/db/repository";
import { createClient } from "@/lib/db/supabase/server";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url), 303);

  if (usingLocalDb()) {
    response.cookies.set("rbai_local_user", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return response;
}
