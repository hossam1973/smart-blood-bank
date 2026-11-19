// الطلب المتوقع خلال 48 ساعة لكل فصيلة (من نمط الصرف لآخر 4 أسابيع + الطلبات المفتوحة) مقارنة بالرصيد
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { fmt, getLang, useT } from "../lib/i18n";
import { C, Card, s } from "../lib/ui";

type Row = { blood_type: string; expected_units: number; open_request_units: number; stock: number; shortfall: number; peak_hour: string | null };

export default function Demand48() {
  const t = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { supabase.rpc("demand_forecast_48h").then(({ data }) => setRows((data ?? []) as Row[])); }, []);
  if (!rows) return null;
  const active = rows.filter((r) => Number(r.expected_units) > 0 || r.open_request_units > 0);
  const max = Math.max(1, ...active.map((r) => Math.max(Number(r.expected_units) + r.open_request_units, r.stock)));

  return (
    <Card>
      <Text style={s.h2}>{t.demand48Title}</Text>
      {active.length === 0 ? <Text style={s.p}>{t.noDemandData}</Text> : active.map((r) => {
        const need = Number(r.expected_units) + r.open_request_units;
        const short = Number(r.shortfall) > 0;
        return (
          <View key={r.blood_type} style={{ gap: 4, paddingVertical: 4 }}>
            <View style={s.row}>
              <Text style={s.badge}>{r.blood_type}</Text>
              <Text style={[s.p, { fontSize: 12, color: short ? C.red : C.mute }]}>
                {t.expected48} {r.expected_units} · {t.openReq} {r.open_request_units} · {t.inventoryTitle.split(" ")[0]} {r.stock}
                {short ? ` · ${t.shortfall} ${r.shortfall}` : ""}
              </Text>
            </View>
            {/* شريط: الطلب (أحمر) مقابل الرصيد (رمادي) */}
            <View style={{ height: 8, backgroundColor: C.line, borderRadius: 4, overflow: "hidden" }}>
              <View style={{ width: `${(Math.min(r.stock, max) / max) * 100}%`, height: 8, backgroundColor: "#9E9EA7" }} />
            </View>
            <View style={{ height: 8, backgroundColor: C.redSoft, borderRadius: 4, overflow: "hidden" }}>
              <View style={{ width: `${(need / max) * 100}%`, height: 8, backgroundColor: short ? C.red : "#E08A00" }} />
            </View>
            {r.peak_hour && <Text style={[s.p, { fontSize: 11 }]}>{fmt(t.peakAt, { t: new Date(r.peak_hour).toLocaleString(getLang(), { weekday: "short", hour: "2-digit", minute: "2-digit" }) })}</Text>}
          </View>
        );
      })}
    </Card>
  );
}
