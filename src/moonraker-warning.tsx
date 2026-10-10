// this probably does not need to be a seperate file, move this elsewhere.
export function MoonrakerWarning() {
  return (
    <div className="warning-banner" role="alert">
      <strong>Moonraker support is untested.</strong>
      <span>
        It is implemented from the Moonraker API documentation but has not been
        tried against a real Klipper printer. Expect problems, and don't leave a
        printer unattended while using it.
      </span>
    </div>
  );
}
