import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function htmlResponse(message, status = 200) {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ClearLens</title>
    <style>
      body { margin: 0; font-family: Georgia, serif; background: #faf9f7; color: #1a1a1a; }
      main { max-width: 640px; margin: 0 auto; padding: 96px 24px; text-align: center; }
      h1 { font-size: 36px; margin: 0 0 16px; }
      p { font-size: 18px; line-height: 1.7; color: #3d3d3d; }
      a { color: #c9243f; }
    </style>
  </head>
  <body>
    <main>
      <h1>ClearLens</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}

export async function GET(request) {
  if (!isSupabaseConfigured() || !supabase) {
    return htmlResponse("Unable to update your subscription right now.", 500);
  }

  const { searchParams } = new URL(request.url);
  const email = String(searchParams.get("email") || "").trim().toLowerCase();

  if (!email) {
    return htmlResponse("No email address was provided.", 400);
  }

  const { error } = await supabase.from("subscriptions").update({ active: false }).eq("email", email);

  if (error) {
    return htmlResponse("Unable to update your subscription right now.", 500);
  }

  return htmlResponse("You have been unsubscribed from ClearLens.", 200);
}
