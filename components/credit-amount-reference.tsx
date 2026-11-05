"use client";

import { useId, useRef } from "react";
import { Table2, X } from "lucide-react";
import { Localized, useLanguage } from "@/components/language-provider";
import { estimateTextTokens } from "@/lib/ai-credit-rates";
import type { CreditOptions } from "@/lib/credit-pricing";

export function CreditAmountReference({ options, selectedCents }: { options: CreditOptions | null; selectedCents: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const zh = useLanguage().language === "zh";
  const number = (value: number) => value.toLocaleString("en");
  return <>
    <button type="button" className="chat-usage-trigger" disabled={!options} onClick={() => dialog.current?.showModal()} aria-haspopup="dialog"><Table2 size={16} aria-hidden="true" /><Localized en="View credit amounts" zh="查看充值积分" /></button>
    <dialog ref={dialog} className="chat-usage-dialog topup-reference-dialog" aria-labelledby={titleId}>
      <div className="chat-usage-header"><div><h2 id={titleId}><Localized en="Top-up credits & text tokens" zh="充值积分与文字 Token" /></h2><p><Localized en="Compare the credits added by each top-up." zh="比较各充值金额可获得的积分。" /></p></div><button type="button" className="chat-usage-close" onClick={() => dialog.current?.close()} aria-label={zh ? "关闭充值积分表" : "Close credit amounts"}><X size={20} /></button></div>
      {options ? <>
        <div className="topup-reference-scroll"><table className="topup-reference-table"><thead><tr><th scope="col"><Localized en="Top-up" zh="充值金额" /></th><th scope="col"><Localized en="AI credits" zh="AI 积分" /></th><th scope="col"><Localized en="Input tokens only ≈" zh="仅输入 Token ≈" /></th><th scope="col"><Localized en="Output tokens only ≈" zh="仅输出 Token ≈" /></th></tr></thead><tbody>{options.options.map(option => {
          const tokens = options.textEstimate ? estimateTextTokens(option.credits, options.textEstimate) : null;
          return <tr key={option.sgdCents} className={selectedCents === option.sgdCents ? "is-selected" : undefined}><th scope="row">S${(option.sgdCents / 100).toFixed(0)}<small>{zh ? "约" : "≈"} ¥{(option.cnyCents / 100).toFixed(2)}</small></th><td><strong>{number(option.credits)}</strong></td><td>{tokens ? number(tokens.inputOnly) : "—"}</td><td>{tokens ? number(tokens.outputOnly) : "—"}</td></tr>;
        })}</tbody></table></div>
        <p className="topup-note">{zh ? `积分汇率参考日期：${options.rateDate}。充值积分会在结账开始时确定；汇率更新后，未来充值的积分可能变化。` : `Credit exchange-rate date: ${options.rateDate}. Credits are fixed when checkout starts; future top-ups may change with exchange rates.`}</p>
        <p className="topup-note">{options.textEstimate ? (zh ? `Token 估算以 ${options.textEstimate.modelLabel} 为参考，按全部积分仅用于输入或仅用于输出分别计算，两列不可相加。实际用量取决于模型、输入输出比例、上下文及其他费用。图片和视频使用相同积分余额，并不按此文字 Token 估算计费。` : `Token estimates use ${options.textEstimate.modelLabel} and assume the full balance is used entirely for input OR entirely for output. The columns cannot be added together. Actual usage depends on the model, input/output mix, context and other charges. Images and videos share the credit balance and use different pricing.`) : <Localized en="Text-token estimates are temporarily unavailable. The AI credit amounts above are still available." zh="文字 Token 估算暂时不可用，仍可按上表积分充值。" />}</p>
      </> : null}
    </dialog>
  </>;
}
