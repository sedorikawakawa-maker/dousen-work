// スタッフアカウント作成（開発用CLI）。
// スタッフ管理画面が実装されるまでの暫定手段。
//
// 実行例:
//   node --env-file=.env.local scripts/create-staff.mjs \
//     --lastName 川島 --firstName 愛佳 --role president --password "temporary-strong-password"
//
// role: president | executive | employee | part_time

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { lastName, firstName, role, password } = args;

  if (!lastName || !firstName || !role || !password) {
    console.error(
      "使い方: node --env-file=.env.local scripts/create-staff.mjs --lastName 姓 --firstName 名 --role president|executive|employee|part_time --password パスワード",
    );
    process.exit(1);
  }

  const allowedRoles = ["president", "executive", "employee", "part_time"];
  if (!allowedRoles.includes(role)) {
    console.error(`role は次のいずれかを指定してください: ${allowedRoles.join(", ")}`);
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const emailDomain = process.env.STAFF_AUTH_EMAIL_DOMAIN;

  if (!supabaseUrl || !serviceRoleKey || !emailDomain) {
    console.error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / STAFF_AUTH_EMAIL_DOMAIN が .env.local に必要です。",
    );
    process.exit(1);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // staff.id を先に採番し、内部専用メール（{staff.id}@domain）でAuthユーザーを作成した後、
  // 同じidでstaff行を作成する（auth_user_idがNOT NULL FKのため作成順序に注意）。
  const staffId = randomUUID();
  const email = `${staffId}@${emailDomain}`;

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authUser?.user) {
    console.error("Authユーザーの作成に失敗しました:", authError?.message);
    process.exit(1);
  }

  const { data: staffRow, error: insertError } = await admin
    .from("staff")
    .insert({
      id: staffId,
      auth_user_id: authUser.user.id,
      last_name: lastName,
      first_name: firstName,
      role,
    })
    .select("id")
    .single();

  if (insertError || !staffRow) {
    console.error("staff行の作成に失敗しました:", insertError?.message);
    await admin.auth.admin.deleteUser(authUser.user.id);
    process.exit(1);
  }

  console.log(`スタッフを作成しました: ${lastName} ${firstName} (${role})`);
  console.log(`staff.id = ${staffRow.id}`);
}

main();
