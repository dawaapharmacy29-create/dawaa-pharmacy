# قائمة تحقق مزامنة تصنيف العملاء

- تصنيف الأهمية يعتمد على `avg_monthly` وفق القواعد الموحدة في `src/lib/customerMetrics.ts`.
- حالة النشاط تعتمد على عمر `last_purchase` وفق القواعد نفسها.
- تتم مزامنة `segment` و`classification` و`customer_status` و`last_purchase` و`days_since_last_purchase` للمتابعات المفتوحة.
