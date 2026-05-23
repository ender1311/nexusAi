import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PAYLOAD_TEMPLATE = `{
    "users": [
        {% for row in rows %}
        {
            "external_user_id": {{ row['user_id'] | append: '' | json }},
            "braze_id": {{ row['braze_user_id_latest'] | append: '' | json }},
            "funnel_stage": {{ "new_user" | json }},
            "attributes": {
                "first_name": {{ row['first_name'] | default: "" | json }},
                "last_name": {{ row['last_name'] | default: "" | json }},
                "email": {{ row['email'] | default: "" | json }},
                "last_seen_at": {{ row['last_seen_timestamp'] | default: "" | json }},
                "language_tag": {{ row['language_tag'] | default: "" | json }},
                "plan_locale": {{ row['plan_locale_latest'] | default: "" | json }},
                "preferred_bible_version_id": {{ row['text_bible_version_id_latest'] | json }},
                "source_application": {{ row['source_application'] | default: "" | json }},
                "country_latest": {{ row['country_latest'] | default: "" | json }},
                "newsletter_push_enabled": {{ row['newsletter_push_enabled'] | default: true | json }},
                "newsletter_email_enabled": {{ row['newsletter_email_enabled'] | default: true | json }}
            }
        }{% unless forloop.last %},{% endunless %}
        {% endfor %}
        ]
    }`;

const LAPSED_DAU_SQL = `WITH activity_windows AS (
  SELECT
    hightouch_user_id
  , MAX(occurred_date)                                              AS last_seen_date
  , COUNTIF(
        occurred_date <= DATE_SUB(CURRENT_DATE(), INTERVAL 0 DAY)
    AND occurred_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
    )                                                               AS cnt_week1
  , COUNTIF(
        occurred_date <= DATE_SUB(CURRENT_DATE(), INTERVAL 8 DAY)
    AND occurred_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
    )                                                               AS cnt_week2
  , COUNTIF(
        occurred_date <= DATE_SUB(CURRENT_DATE(), INTERVAL 15 DAY)
    AND occurred_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 21 DAY)
    )                                                               AS cnt_week3
  , COUNTIF(
        occurred_date <= DATE_SUB(CURRENT_DATE(), INTERVAL 22 DAY)
    AND occurred_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)
    )                                                               AS cnt_week4
  FROM shared_hightouch.hightouch_dimension_user_daily_active
  WHERE occurred_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)
  GROUP BY hightouch_user_id
)

SELECT
  p.user_id
, p.braze_user_id_latest
, p.first_name
, p.last_name
, p.email
, p.language_tag
, p.plan_locale_latest
, p.text_bible_version_id_latest
, p.source_application
, p.country_latest
, p.device_id_latest
, p.notification_settings
, e.last_seen_timestamp
, a.last_seen_date
, u.newsletter_push_enabled
, u.newsletter_email_enabled

FROM shared_hightouch.hightouch_youversion_unified_profiles AS p
INNER JOIN activity_windows AS a
  ON p.hightouch_user_id = a.hightouch_user_id
LEFT JOIN shared_hightouch.hightouch_dimension_engagement_traits AS e
  ON p.hightouch_user_id = e.hightouch_user_id
LEFT JOIN shared_hightouch.hightouch_youversion_users_flattened AS u
  ON p.user_id = u.user_id

WHERE
  cnt_week1 = 0          -- inactive this week (the "lapsed" gate)
  AND cnt_week2 >= 4     -- active 4+ days in days 8–14
  AND cnt_week3 >= 4     -- active 4+ days in days 15–21
  AND cnt_week4 >= 4     -- active 4+ days in days 22–28
  AND (
    p.user_id IS NOT NULL
    OR p.braze_user_id_latest IS NOT NULL
    OR p.device_id_latest IS NOT NULL
  )`;

export function PayloadReference() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Payload Template Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hightouch → Nexus Payload Template</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Liquid template used in Hightouch to format user sync payloads to Nexus{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded">/api/ingest/users</code>
          </p>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted rounded-md p-4 text-xs font-mono overflow-auto max-h-[60vh] whitespace-pre leading-relaxed">
            {PAYLOAD_TEMPLATE}
          </pre>
        </CardContent>
      </Card>

      {/* Lapsed DAU SQL Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lapsed DAU Model SQL</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            BigQuery model query identifying users who were active 3 consecutive weeks but lapsed
            this week
          </p>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted rounded-md p-4 text-xs font-mono overflow-auto max-h-[60vh] whitespace-pre leading-relaxed">
            {LAPSED_DAU_SQL}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
