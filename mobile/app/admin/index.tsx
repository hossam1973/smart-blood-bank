// إدارة المنصة (للمدير فقط): الإحصاءات والإيرادات، المستخدمون والصلاحيات، المنشآت والباقات، الحملات، سجل التدقيق
// كل التعديلات محمية في قاعدة البيانات (RLS + مشغّلات الحراسة) وتُسجَّل في audit_log تلقائيًا
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { getMyProfile, supabase, toPoint } from "../../lib/supabase";
import { fmt, getLang, useT } from "../../lib/i18n";
import { Button, C, Card, Chips, Field, s, notify, confirmAction } from "../../lib/ui";

type Tab = "overview" | "users" | "facilities" | "campaigns" | "audit";
type Stats = Record<string, number | null | Record<string, number>>;
type User = { id: string; full_name: string; phone: string | null; role: string; facility_id: string | null; suspended: boolean; blood_type: string | null };
type Fac = { id: string; name: string; kind: string; verified: boolean; suspended: boolean; plan: string; phone: string | null };
type Audit = { id: number; actor: string | null; action: string; target_type: string; target_id: string; details: Record<string, unknown>; at: string };
type Camp = { id: string; title: string; org_name: string; join_code: string; status: string; fee_egp: number; starts_at: string; campaign_signups: { count: number }[] };
const ROLES = ["donor", "beneficiary", "facility_staff", "admin"] as const;
const PLANS = ["free", "pro", "enterprise"] as const;

function Stat({ label, value, tone }: { label: string; value: string | number | null | undefined; tone?: string }) {
  return (
    <Card style={{ width: "47%", gap: 2 }}>
      <Text style={[s.h1, { fontSize: 22, color: tone ?? C.ink }]}>{value ?? "—"}</Text>
      <Text style={[s.p, { fontSize: 12 }]}>{label}</Text>
    </Card>
  );
}

export default function Admin() {
  const t = useT();
  const T = t as unknown as Record<string, string>;
  const [ok, setOk] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [facs, setFacs] = useState<Fac[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [camps, setCamps] = useState<Camp[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [newFac, setNewFac] = useState({ name: "", kind: "hospital", lat: "", lng: "", phone: "" });
  const [newCamp, setNewCamp] = useState({ title: "", org: "", facility: "", days: "7", fee: "0" });

  const load = useCallback(async () => {
    setLoading(true);
    const me = await getMyProfile();
    if (me?.role !== "admin") { setOk(false); setLoading(false); return; }
    setOk(true);
    const [st, us, fa, au, ca] = await Promise.all([
      supabase.rpc("admin_stats"),
      supabase.from("profiles").select("id,full_name,phone,role,facility_id,suspended,blood_type").order("created_at", { ascending: false }).limit(200),
      supabase.from("facilities").select("id,name,kind,verified,suspended,plan,phone").order("created_at", { ascending: false }),
      supabase.from("audit_log").select("*").order("at", { ascending: false }).limit(100),
      supabase.from("campaigns").select("id,title,org_name,join_code,status,fee_egp,starts_at,campaign_signups(count)").order("created_at", { ascending: false }),
    ]);
    setStats(st.data as Stats); setUsers((us.data ?? []) as User[]); setFacs((fa.data ?? []) as Fac[]);
    setAudit((au.data ?? []) as Audit[]); setCamps((ca.data ?? []) as Camp[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) notify(t.error, error.message); else load();
  };
  const confirmThen = (fn: () => void) => confirmAction(t.confirmAction, t.confirm, t.cancel, fn);

  if (ok === false) return <View style={[s.screen, s.pad]}><Text style={s.p}>{t.adminOnly}</Text></View>;
  const facName = (id: string | null) => facs.find((f) => f.id === id)?.name ?? "—";
  const n = (k: string) => stats?.[k] as number | null | undefined;
  const tabs: [Tab, string][] = [["overview", t.overview], ["users", t.users], ["facilities", t.facilities], ["campaigns", t.campaigns], ["audit", t.audit]];
  const shown = users.filter((u) => !q.trim() || u.full_name.toLowerCase().includes(q.toLowerCase()) || (u.phone ?? "").includes(q.trim()));

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {tabs.map(([k, l]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[s.chip, tab === k && s.chipOn]}>
            <Text style={[s.chipText, tab === k && { color: "#fff" }]}>{l}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {tab === "overview" && stats && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Stat label={t.s_mrr} value={fmt(t.egpMonth, { n: (n("mrr_egp") ?? 0).toLocaleString(getLang()) })} tone={C.ok} />
            <Stat label={t.s_campaignFees} value={(n("campaign_fees_30d") ?? 0).toLocaleString(getLang())} tone={C.ok} />
            <Stat label={t.s_donors} value={n("donors")} />
            <Stat label={t.s_eligible} value={n("donors_eligible")} />
            <Stat label={t.s_facilities} value={n("facilities_verified")} />
            <Stat label={t.s_pending} value={n("facilities_pending")} tone={n("facilities_pending") ? C.red : undefined} />
            <Stat label={t.s_open} value={n("requests_open")} tone={n("requests_open") ? C.red : undefined} />
            <Stat label={t.s_fulfilled30} value={n("requests_fulfilled_30d")} />
            <Stat label={t.s_avgHours} value={n("avg_fulfil_hours_30d")} />
            <Stat label={t.s_donations30} value={n("donations_30d")} />
            <Stat label={t.s_lives} value={n("lives_estimate_total")} tone={C.red} />
            <Stat label={t.s_suspended} value={n("users_suspended")} />
          </View>
          <Card>
            <Text style={s.h2}>{t.revenue} · {t.plan}</Text>
            {PLANS.map((p) => (
              <View key={p} style={s.row}>
                <Text style={s.label}>{T[`plan_${p}`]}</Text>
                <Text style={s.p}>{(stats.by_plan as Record<string, number>)?.[p] ?? 0}</Text>
              </View>
            ))}
          </Card>
        </>
      )}

      {tab === "users" && (
        <>
          <Field label={t.search} placeholder={t.searchUsers} value={q} onChangeText={setQ} />
          {shown.map((u) => (
            <Card key={u.id} style={u.suspended ? { borderColor: C.red } : undefined}>
              <View style={s.row}>
                <Text style={s.h2}>{u.full_name}</Text>
                {u.suspended ? <Text style={s.badge}>{t.suspended}</Text> : u.blood_type ? <Text style={s.badge}>{u.blood_type}</Text> : null}
              </View>
              <Text style={s.p}>{u.phone ?? "—"} · {facName(u.facility_id)}</Text>
              <Text style={s.label}>{t.role}</Text>
              <Chips options={[...ROLES]} value={u.role as typeof ROLES[number]}
                onChange={(r) => r !== u.role && confirmThen(() => act(supabase.from("profiles").update({ role: r }).eq("id", u.id)))} />
              {u.role === "facility_staff" && (linking === u.id ? (
                <View style={{ gap: 6 }}>
                  {facs.filter((f) => f.verified).map((f) => (
                    <Button key={f.id} title={f.name} kind="ghost" onPress={() => { setLinking(null); act(supabase.from("profiles").update({ facility_id: f.id }).eq("id", u.id)); }} />
                  ))}
                  {u.facility_id && <Button title={t.unlink} kind="ghost" onPress={() => { setLinking(null); act(supabase.from("profiles").update({ facility_id: null }).eq("id", u.id)); }} />}
                </View>
              ) : <Button title={t.linkFacility} kind="ghost" onPress={() => setLinking(u.id)} />)}
              <Button title={u.suspended ? t.unsuspend : t.suspend} kind={u.suspended ? "primary" : "ghost"}
                onPress={() => confirmThen(() => act(supabase.from("profiles").update({ suspended: !u.suspended }).eq("id", u.id)))} />
            </Card>
          ))}
        </>
      )}

      {tab === "facilities" && (
        <>
          <Card>
            <Text style={s.h2}>{t.addFacility}</Text>
            <Field label={t.facName} value={newFac.name} onChangeText={(v) => setNewFac({ ...newFac, name: v })} />
            <Text style={s.label}>{t.facKind}</Text>
            <Chips options={["hospital", "blood_bank", "medical_center", "lab"]} value={newFac.kind} onChange={(v) => setNewFac({ ...newFac, kind: v })} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Field label={t.lat} keyboardType="decimal-pad" value={newFac.lat} onChangeText={(v) => setNewFac({ ...newFac, lat: v })} /></View>
              <View style={{ flex: 1 }}><Field label={t.lng} keyboardType="decimal-pad" value={newFac.lng} onChangeText={(v) => setNewFac({ ...newFac, lng: v })} /></View>
            </View>
            <Field label={t.phone} keyboardType="phone-pad" value={newFac.phone} onChangeText={(v) => setNewFac({ ...newFac, phone: v })} />
            <Button title={t.save} disabled={!newFac.name || isNaN(+newFac.lat) || isNaN(+newFac.lng) || !newFac.lat || !newFac.lng}
              onPress={() => { act(supabase.from("facilities").insert({ name: newFac.name, kind: newFac.kind, phone: newFac.phone || null,
                location: toPoint(+newFac.lat, +newFac.lng), verified: true })); setNewFac({ name: "", kind: "hospital", lat: "", lng: "", phone: "" }); }} />
          </Card>
          {facs.map((f) => (
            <Card key={f.id} style={f.suspended ? { borderColor: C.red } : !f.verified ? { borderColor: "#E08A00" } : undefined}>
              <View style={s.row}>
                <Text style={s.h2}>{f.name}</Text>
                <Text style={s.badge}>{f.suspended ? t.suspended : f.verified ? t.verified : t.pending}</Text>
              </View>
              <Text style={s.p}>{T[`k_${f.kind}`]} · {f.phone ?? "—"}</Text>
              <Text style={s.label}>{t.plan}</Text>
              <Chips options={[...PLANS]} value={f.plan as typeof PLANS[number]}
                onChange={(p) => p !== f.plan && act(supabase.from("facilities").update({ plan: p, plan_renews_at: p === "free" ? null : new Date(Date.now() + 30 * 864e5).toISOString() }).eq("id", f.id))} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}><Button title={f.verified ? t.unverify : t.verify} kind={f.verified ? "ghost" : "primary"}
                  onPress={() => act(supabase.from("facilities").update({ verified: !f.verified }).eq("id", f.id))} /></View>
                <View style={{ flex: 1 }}><Button title={f.suspended ? t.unsuspend : t.suspend} kind="ghost"
                  onPress={() => confirmThen(() => act(supabase.from("facilities").update({ suspended: !f.suspended }).eq("id", f.id)))} /></View>
              </View>
            </Card>
          ))}
        </>
      )}

      {tab === "campaigns" && (
        <>
          <Card>
            <Text style={s.h2}>{t.createCampaign}</Text>
            <Field label={t.campaignTitle} value={newCamp.title} onChangeText={(v) => setNewCamp({ ...newCamp, title: v })} />
            <Field label={t.org} value={newCamp.org} onChangeText={(v) => setNewCamp({ ...newCamp, org: v })} />
            <Text style={s.label}>{t.facilities}</Text>
            <Chips options={facs.filter((f) => f.verified).map((f) => f.name)} value={facs.find((f) => f.id === newCamp.facility)?.name ?? null}
              onChange={(name) => setNewCamp({ ...newCamp, facility: facs.find((f) => f.name === name)!.id })} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Field label={t.days} keyboardType="number-pad" value={newCamp.days} onChangeText={(v) => setNewCamp({ ...newCamp, days: v })} /></View>
              <View style={{ flex: 1 }}><Field label={t.feeEgp} keyboardType="number-pad" value={newCamp.fee} onChangeText={(v) => setNewCamp({ ...newCamp, fee: v })} /></View>
            </View>
            <Button title={t.save} disabled={!newCamp.title || !newCamp.org || !newCamp.facility}
              onPress={() => {
                const start = new Date(Date.now() + 864e5);
                act(supabase.from("campaigns").insert({ title: newCamp.title, org_name: newCamp.org, facility_id: newCamp.facility,
                  starts_at: start.toISOString(), ends_at: new Date(start.getTime() + Math.max(1, +newCamp.days || 1) * 864e5).toISOString(),
                  fee_egp: Math.max(0, +newCamp.fee || 0) }));
                setNewCamp({ title: "", org: "", facility: "", days: "7", fee: "0" });
              }} />
          </Card>
          {camps.map((c) => (
            <Card key={c.id}>
              <View style={s.row}><Text style={s.h2}>{c.title}</Text><Text style={s.badge}>{c.join_code}</Text></View>
              <Text style={s.p}>{c.org_name} · {new Date(c.starts_at).toLocaleDateString(getLang())} · {fmt(t.signups, { n: c.campaign_signups?.[0]?.count ?? 0 })} · {c.fee_egp} EGP</Text>
            </Card>
          ))}
        </>
      )}

      {tab === "audit" && (audit.length === 0 ? <Text style={s.p}>{t.auditEmpty}</Text> : audit.map((a) => (
        <Card key={a.id} style={{ gap: 2 }}>
          <View style={s.row}>
            <Text style={s.label}>{a.target_type} · {a.action}</Text>
            <Text style={[s.p, { fontSize: 12 }]}>{new Date(a.at).toLocaleString(getLang())}</Text>
          </View>
          <Text style={[s.p, { fontSize: 12 }]}>{users.find((u) => u.id === a.actor)?.full_name ?? a.actor?.slice(0, 8) ?? "system"} → {users.find((u) => u.id === a.target_id)?.full_name ?? facName(a.target_id) ?? a.target_id}</Text>
          <Text style={[s.p, { fontSize: 12, color: C.ink }]}>{JSON.stringify(a.details)}</Text>
        </Card>
      )))}
    </ScrollView>
  );
}
