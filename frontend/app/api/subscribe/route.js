import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { sendSubscriptionConfirmationEmail } from "@/lib/resend";

export const dynamic = "force-dynamic";

function normalizeList(values) {
  return Array.from(
    new Set(
      Array.isArray(values)
        ? values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
        : [],
    ),
  );
}

export async function POST(request) {
  if (!isSupabaseConfigured() || !supabase) {
    return NextResponse.json({ error: "Subscription storage is unavailable" }, { status: 500 });
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const topics = normalizeList(body?.topics);
  const sections = normalizeList(body?.sections);

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const user = await currentUser();
  const userId = String(body?.user_id || user?.id || "").trim() || null;
  const nextTopics = topics.length > 0 ? topics : [];
  const nextSections = sections.length > 0 ? sections : ["all"];

  const { error } = await supabase
    .from("subscriptions")
    .upsert(
      {
        email,
        user_id: userId,
        topics: nextTopics,
        sections: nextSections,
        active: true,
      },
      { onConflict: "email" },
    );

  if (error) {
    return NextResponse.json(
      {
        error: "Failed to save subscription",
        details: String(error.message || error),
      },
      { status: 500 },
    );
  }

  try {
    await sendSubscriptionConfirmationEmail({ email, topics: nextTopics, sections: nextSections });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Subscription saved, but confirmation email could not be sent",
        details: String(error?.message || error),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
