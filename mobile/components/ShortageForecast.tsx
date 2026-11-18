// =====================================================================
// لوحة التنبؤ الذكي بنقص المخزون:
// مصفوفة الرصد اللحظي + منحنى الاستنزاف + خطة التدخل + زر النداء الفوري
// - الأرقام تُحسب فورًا على الجهاز عند تحريك أي إعداد (نفس محرك الخادم).
// - خطة التدخل تأتي من الخادم (ذكاء اصطناعي) مع احتياطي فوري بالقواعد.
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, Text, View, useWindowDimensions } from "react-native";
import Svg, { Line, Path, Text as SvgText } from "react-native-svg";
import { supabase } from "../lib/supabase";
import {
  forecastAll, type Intervention, ruleBasedInterventions, type Season, type StockInput, type Surge, type TypeForecast,
} from "../lib/forecast";
import { fmt, useLang, useT } from "../lib/i18n";
import { Button, C, Card, s, notify } from "../lib/ui";

const SEASONS: Season[] = ["none", "ramadan", "hajj", "summer", "flu", "holidays"];
const SURGES: Surge[] = ["moderate", "high", "code_red"];
const RISK_COLOR = { critical: C.red, warning: "#E08A00", stable: C.ok };

export default function ShortageForecast({ facilityId }: { facilityId: string }) {
  const t = useT();
  const T = t as unknown as Record<string, string>;
  const lang = useLang();
  const ruleLang = lang === "ar" ? "ar" : "en";
  const [inputs, setInputs] = useState<StockInput[]>([]);
  const [season, setSeason] = useState<Season>("none");
  const [surge, setSurge] = useState<Surge>("moderate");
  const [horizon, setHorizon] = useState(14);
  const [plan, setPlan] = useState<{ items: Intervention[]; source: "ai" | "rules" } | null>(null);
  const [offline, setOffline] = useState(false);
  const [busyType, setBusyType] = useState<string | null>(null);

  const loadInputs = useCallback(async () => {
    const { data, error } = await supabase.rpc("forecast_inputs", { p_facility: facilityId });
    if (error) { setOffline(true); return; }
    setOffline(false);
    setInputs((data ?? []).map((r: StockInput) => ({
      ...r, units: +r.units, safety_stock: +r.safety_stock, burn_rate: +r.burn_rate, inflow_rate: +r.inflow_rate })));
  }, [facilityId]);
  useEffect(() => { loadInputs(); }, [loadInputs]);

  // حساب فوري محلي
  const params = { season, surge, horizon_days: horizon };
  const forecast = useMemo(() => forecastAll(inputs, params), [inputs, season, surge, horizon]);

  // خطة الذكاء الاصطناعي من الخادم (مؤجلة 600ms لتفادي الطلبات المتكررة أثناء التحريك)
  useEffect(() => {
    if (!inputs.length) return;
    setPlan({ items: ruleBasedInterventions(forecast, params, ruleLang), source: "rules" }); // فوري
    const h = setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke("predict-shortages",
        { body: { season, surge, horizon_days: horizon, lang } });
      if (!error && data?.interventions) setPlan({ items: data.interventions, source: data.source });
    }, 600);
    return () => clearTimeout(h);
  }, [inputs, season, surge, horizon, lang]);

  const move = async (bt: string, kind: "issue" | "deposit") => {
    setBusyType(bt + kind);
    const { error } = await supabase.rpc("record_movement", { p_blood_type: bt, p_kind: kind, p_units: 1 });
    setBusyType(null);
    if (error) return notify("⚠️", error.message);
    loadInputs();
  };

  const atRisk = forecast.filter((f) => f.risk !== "stable").map((f) => f.blood_type);
  const recall = async () => {
    if (!atRisk.length) return notify(t.recallNone);
    const { data, error } = await supabase.functions.invoke("donor-recall", { body: { blood_types: atRisk, lang } });
    if (error) return notify("⚠️", error.message);
    if (data.blood_types?.length) notify("✅", fmt(t.recallDone, { n: data.notified, t: data.blood_types.join(", ") }));
    else notify("⏳", t.cooldown);
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={s.row}>
        <Text style={s.h2}>{t.forecastTitle}</Text>
      </View>
      {offline && <Text style={[s.p, { color: C.red }]}>{t.offline}</Text>}

      {/* إعدادات السيناريو */}
      <Card>
        <Text style={s.label}>{t.season}</Text>
        <ChipRow options={SEASONS} value={season} onChange={setSeason} label={(x) => T[`sea_${x}`]} />
        <Text style={s.label}>{t.surge}</Text>
        <ChipRow options={SURGES} value={surge} onChange={setSurge} label={(x) => T[`sur_${x}`]} />
        <Text style={s.label}>{t.horizon}: {horizon} {t.days}</Text>
        <HorizonSlider value={horizon} onChange={setHorizon} />
      </Card>

      {/* مصفوفة الرصد اللحظي */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {forecast.map((f) => (
          <TypeCard key={f.blood_type} f={f} busy={busyType} onMove={move} />
        ))}
      </View>

      {/* منحنى الاستنزاف */}
      <Card>
        <Text style={s.h2}>{t.chart}</Text>
        <TrajectoryChart series={forecast.slice(0, 2)} />
      </Card>

      {/* خطة التدخل */}
      <Card>
        <View style={s.row}>
          <Text style={s.h2}>{t.plan_title}</Text>
          {plan && <Text style={[s.badge, plan.source === "rules" && { backgroundColor: "#EEE", color: C.mute }]}>
            {plan.source === "ai" ? t.aiSource : t.rulesSource}</Text>}
        </View>
        {plan?.items.map((it, i) => (
          <View key={i} style={{ borderTopWidth: i ? 1 : 0, borderColor: C.line, paddingTop: i ? 8 : 0, gap: 2 }}>
            <Text style={s.label}>{it.title} <Text style={{ color: C.red }}>· {T[`pr_${it.priority}`]}</Text></Text>
            <Text style={s.p}>{it.detail}</Text>
          </View>
        ))}
        <Text style={[s.p, { fontSize: 12 }]}>{t.assumptions}</Text>
      </Card>

      <Button title={`${t.recall}${atRisk.length ? ` (${atRisk.join(" ")})` : ""}`} onPress={recall} />
    </View>
  );
}

function ChipRow<T extends string>({ options, value, onChange, label }: {
  options: T[]; value: T; onChange: (v: T) => void; label: (v: T) => string }) {
  return (
    <View style={s.chips}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} style={[s.chip, value === o && s.chipOn]}>
          <Text style={[s.chipText, value === o && { color: "#fff" }, { fontSize: 13 }]}>{label(o)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// شريط تفاعلي 7–30 يومًا (بدون مكتبة إضافية)
function HorizonSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(1);
  const pick = (x: number) => onChange(Math.round(7 + Math.max(0, Math.min(1, x / w)) * 23));
  const pct = (value - 7) / 23;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => pick(e.nativeEvent.locationX)} onResponderMove={(e) => pick(e.nativeEvent.locationX)}
      style={{ height: 32, justifyContent: "center", direction: "ltr" }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: C.line }}>
        <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: C.red }} />
      </View>
      <View style={{ position: "absolute", left: pct * (w - 22), width: 22, height: 22, borderRadius: 11, backgroundColor: C.red }} />
    </View>
  );
}

function TypeCard({ f, busy, onMove }: { f: TypeForecast; busy: string | null; onMove: (bt: string, k: "issue" | "deposit") => void }) {
  const t = useT();
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (f.risk !== "critical") { blink.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(blink, { toValue: 0.35, duration: 500, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [f.risk]);
  const color = RISK_COLOR[f.risk];
  const T = t as unknown as Record<string, string>;

  return (
    <Card style={{ width: "47%", borderColor: color, borderWidth: f.risk === "stable" ? 1 : 2 }}>
      <View style={s.row}>
        <Text style={[s.badge, { fontSize: 16 }]}>{f.blood_type}</Text>
        <Animated.Text style={{ opacity: blink, color, fontWeight: "700", fontSize: 12 }}>{T[`risk_${f.risk}`]}</Animated.Text>
      </View>
      <Text style={[s.h1, { fontSize: 22 }]}>{f.units} <Text style={{ fontSize: 13, color: C.mute }}>{t.units}</Text></Text>
      <Text style={[s.p, { fontSize: 12, lineHeight: 18 }]}>
        {t.safety}: {f.safety_stock} · {t.burn}: {f.eff_burn}{t.perDay}{"\n"}
        {t.inflow}: {f.eff_inflow}{t.perDay} · {t.net}: {f.net_daily > 0 ? "+" : ""}{f.net_daily}
      </Text>
      <Text style={[s.p, { fontSize: 12, color, fontWeight: "700" }]}>
        {f.days_until_depletion === null ? t.noDepletion
          : fmt(t.depletesIn, { d: f.days_until_depletion, date: f.depletion_date ?? "" })}
      </Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <MiniBtn label={`− ${t.issue}`} disabled={busy === f.blood_type + "issue" || f.units === 0} onPress={() => onMove(f.blood_type, "issue")} />
        <MiniBtn label={`+ ${t.deposit}`} disabled={busy === f.blood_type + "deposit"} onPress={() => onMove(f.blood_type, "deposit")} />
      </View>
    </Card>
  );
}

const MiniBtn = ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
  <Pressable onPress={onPress} disabled={disabled} style={[s.chip, { flex: 1, alignItems: "center", paddingHorizontal: 4 }, disabled && { opacity: 0.4 }]}>
    <Text style={[s.chipText, { fontSize: 12 }]}>{label}</Text>
  </Pressable>
);

// منحنى مساحي لأخطر فصيلتين مقارنة بالحد الآمن — 14 يومًا دائمًا
function TrajectoryChart({ series }: { series: TypeForecast[] }) {
  const t = useT();
  const { width } = useWindowDimensions();
  const W = Math.min(width - 64, 640), H = 180, P = 24, DAYS = 14;
  if (!series.length) return null;
  const pts = series.map((f) => Array.from({ length: DAYS + 1 }, (_, d) => Math.max(0, f.units + f.net_daily * d)));
  const maxY = Math.max(1, ...pts.flat(), ...series.map((f) => f.safety_stock)) * 1.1;
  const x = (d: number) => P + (d / DAYS) * (W - 2 * P);
  const y = (v: number) => H - P - (v / maxY) * (H - 2 * P);
  const colors = [C.red, "#5E35B1"];

  return (
    <View style={{ direction: "ltr" }}>
      <Svg width={W} height={H}>
        <Line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke={C.line} />
        {series.map((f, i) => {
          const line = pts[i].map((v, d) => `${d ? "L" : "M"}${x(d)},${y(v)}`).join(" ");
          return (
            <Svg key={f.blood_type}>
              <Path d={`${line} L${x(DAYS)},${H - P} L${x(0)},${H - P} Z`} fill={colors[i]} fillOpacity={0.12} />
              <Path d={line} stroke={colors[i]} strokeWidth={2.5} fill="none" />
              <Line x1={P} x2={W - P} y1={y(f.safety_stock)} y2={y(f.safety_stock)} stroke={colors[i]} strokeDasharray="5,4" strokeOpacity={0.6} />
              <SvgText x={W - P} y={y(pts[i][0]) - 6 - i * 12} fontSize={11} fill={colors[i]} textAnchor="end" fontWeight="bold">{f.blood_type}</SvgText>
            </Svg>
          );
        })}
        {[0, 7, 14].map((d) => (
          <SvgText key={d} x={x(d)} y={H - 6} fontSize={10} fill={C.mute} textAnchor="middle">{d}</SvgText>
        ))}
      </Svg>
      <Text style={[s.p, { fontSize: 12 }]}>- - - {t.safetyLine}</Text>
    </View>
  );
}
