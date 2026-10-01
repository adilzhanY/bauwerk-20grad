# Ideas

Things to think about and build later. Nothing here is decided yet; when an idea turns into work, it moves to TODO.md.

## Projects per building

A project for every building: create one when a building is opened, and keep its photos, openings and edits inside it. Switching buildings switches projects, so nothing from one building can land on another (the demo bug in FIXES.md).

## Wall colour from the photo

When a straightened photo is applied to the 3D model, paint the building in the colour of its wall as seen in the photo. The wall colour only, not the colour of the windows.

## Floor plans from old drawings

Import existing floor plans to build the storeys of the 3D model. The plans can be very old, drawn at different scales, with different measurements, names and conventions. The office uses a paid service for this today. Look for a model or a method that can do it, something as big as SAM 3 was for the facades: read the walls, openings, rooms and dimensions from a scanned plan and turn them into storeys.

## Finish the multi-user feature

Work on real-time collaboration until it is complete and reliable enough to show and use.

## A "Magic Box" instead of a complex interface

Hannes said the interface is too difficult for the people who would use it. They need something more like a "Magic Box": put everything in (address, photos, plans, what is known about the building), it does its job, and they see the result. The detailed editor can stay for the cases that need it, but the main path should ask for inputs and show results, not expect people to operate the tools.

## Roles: consultants and home owners

People use Bauwerk in different roles: the energy consultant who does the work, and the home owner (or the WEG, the property manager) the work is done for. How an owner takes part in a project is still open: maybe they see the variants and the report and comment on them, maybe they upload photos or old plans of their own building, maybe they only read. Each role would see and be allowed to do different things in the same project.

## SAM 3 cheaper and as a service

How can SAM 3 be made faster and cheaper for production? Questions to answer: which settings and model sizes it offers (image resolution, fewer prompts per photo, half precision, a smaller or distilled model, batching several photos), what one photo costs on a rented GPU versus on the processor, and whether it can run as its own API that several apps share, with a queue, so the graphics card only runs while there is work.
